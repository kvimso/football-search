import { NextResponse } from "next/server";
import { getSupabaseServerClient, isSupabaseConfigured } from "../../../lib/supabase.js";
import { loadClubsWithSnapshots, storeOpportunities } from "../../../lib/analysis-pipeline.js";
import { analyzeBatchWithGemini } from "../../../lib/gemini-analyzer.js";
import { logPipelineRun, updatePipelineRun } from "../../../lib/pipeline-logger.js";

// Allow up to 60 seconds for Gemini batch analysis (Vercel default is 10s)
export const maxDuration = 60;

const CACHE_MAX_AGE_HOURS = 168; // 7 days

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 }
    );
  }

  // Parse optional force param
  let force = false;
  try {
    const body = await request.json();
    force = body.force === true;
  } catch {
    // No body or invalid JSON — that's fine, force defaults to false
  }

  // Expire stale "running" entries (e.g., from crashed/timed-out functions)
  await supabase
    .from("pipeline_runs")
    .update({ status: "failed", error_log: [{ fatal: "Timed out after 30 minutes" }] })
    .eq("run_type", "analyze")
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

  // Check for concurrent running analysis
  const { data: running } = await supabase
    .from("pipeline_runs")
    .select("id")
    .eq("run_type", "analyze")
    .eq("status", "running")
    .limit(1);

  if (running && running.length > 0) {
    return NextResponse.json(
      { error: "Analysis already in progress", run_id: running[0].id },
      { status: 409 }
    );
  }

  // Check cache freshness (unless force=true)
  if (!force) {
    const { data: freshCheck } = await supabase
      .from("opportunities")
      .select("analyzed_at")
      .eq("is_active", true)
      .order("analyzed_at", { ascending: false })
      .limit(1);

    const latestAnalyzedAt = freshCheck?.[0]?.analyzed_at;
    if (latestAnalyzedAt) {
      const ageMs = Date.now() - new Date(latestAnalyzedAt).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      if (ageHours < CACHE_MAX_AGE_HOURS) {
        // Cache is fresh — return count without re-running
        const { count } = await supabase
          .from("opportunities")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true);

        return NextResponse.json({
          status: "cached",
          opportunities_count: count || 0,
          source: "cache",
          analyzed_at: latestAnalyzedAt,
          age_hours: Math.round(ageHours),
        });
      }
    }
  }

  // Load clubs with snapshots
  let clubs;
  try {
    clubs = await loadClubsWithSnapshots(supabase);
  } catch (err) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }

  if (clubs.length === 0) {
    return NextResponse.json(
      { error: "No clubs with squad data found. Run fetch-squads first." },
      { status: 404 }
    );
  }

  // Log pipeline start
  const runId = await logPipelineRun(supabase, { runType: "analyze", status: "running" });

  let totalProcessed = 0;
  let totalFailed = 0;
  let totalOpportunities = 0;
  const errors = [];

  try {
    // Run Gemini batch analysis (falls back to heuristic if no key)
    const results = await analyzeBatchWithGemini(clubs);

    // Store results
    for (const result of results) {
      const club = clubs.find((c) => c.name === result.club_name);
      if (!club) continue;

      try {
        await storeOpportunities(supabase, club.db_id, club.snapshot_id, result.gaps);
        totalProcessed++;
        totalOpportunities += result.gaps.length;
      } catch (err) {
        errors.push({ club: club.name, error: err.message });
        totalFailed++;
      }
    }

    const finalStatus = totalFailed > 0 ? "partial" : "completed";
    await updatePipelineRun(supabase, runId, {
      status: finalStatus,
      clubs_processed: totalProcessed,
      clubs_failed: totalFailed,
      error_log: errors.length > 0 ? errors : null,
    });

    return NextResponse.json({
      status: finalStatus,
      opportunities_count: totalOpportunities,
      clubs_processed: totalProcessed,
      clubs_failed: totalFailed,
      source: "analysis",
    });
  } catch (err) {
    await updatePipelineRun(supabase, runId, {
      status: "failed",
      clubs_processed: totalProcessed,
      clubs_failed: totalFailed,
      error_log: [...errors, { fatal: err.message }],
    });

    return NextResponse.json(
      { error: `Analysis failed: ${err.message}` },
      { status: 500 }
    );
  }
}
