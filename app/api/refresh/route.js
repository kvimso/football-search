import { NextResponse } from "next/server";
import { getSupabaseServerClient, isSupabaseConfigured } from "../../../lib/supabase.js";
import { isApiFootballConfigured, getCurrentSeason } from "../../../lib/api-football.js";
import { fetchTeamsForLeague, fetchSquadForTeam, upsertClubAndSnapshot } from "../../../lib/data-pipeline.js";
import { loadClubsWithSnapshots, storeOpportunities } from "../../../lib/analysis-pipeline.js";
import { analyzeBatch } from "../../../lib/ai-analyzer.js";
import { logPipelineRun, updatePipelineRun } from "../../../lib/pipeline-logger.js";
import { TARGET_LEAGUES } from "../../../lib/sample-data.js";

// Allow up to 60 seconds (Vercel hobby max)
export const maxDuration = 60;

const SQUAD_MAX_AGE_HOURS = 24;
const ANALYSIS_MAX_AGE_HOURS = 24;
const FETCH_TIME_BUDGET_MS = 40000; // Stop fetching after 40s to leave time for analysis

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  }

  // Clear any stuck "running" rows — Vercel functions max out at 60s,
  // so any "running" row is guaranteed stale
  await supabase
    .from("pipeline_runs")
    .update({ status: "failed", error_log: [{ fatal: "Cleared stale run" }] })
    .eq("status", "running");

  const runId = await logPipelineRun(supabase, { runType: "analyze", status: "running" });
  const startTime = Date.now();

  let squadsFetched = 0;
  let squadsSkipped = 0;
  let squadsFailed = 0;

  // --- Phase 1: Fetch squads if stale (within time budget) ---
  if (isApiFootballConfigured()) {
    // Check how fresh our squad data is
    const { data: latestSnapshot } = await supabase
      .from("squad_snapshots")
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1);

    const latestDate = latestSnapshot?.[0]?.snapshot_date;
    const squadsAgeHours = latestDate
      ? (Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60)
      : Infinity;

    if (squadsAgeHours > SQUAD_MAX_AGE_HOURS) {
      const season = getCurrentSeason();

      for (const league of TARGET_LEAGUES) {
        // Time check — stop fetching if we're running out of time
        if (Date.now() - startTime > FETCH_TIME_BUDGET_MS) break;

        try {
          const { teams } = await fetchTeamsForLeague(league.id, season);

          for (const team of teams) {
            if (Date.now() - startTime > FETCH_TIME_BUDGET_MS) break;

            try {
              const { squad } = await fetchSquadForTeam(team.api_football_id);
              await upsertClubAndSnapshot(supabase, { club: team, league, squad });
              squadsFetched++;
            } catch (err) {
              squadsFailed++;
              if (err.message.includes("daily limit") || err.message.includes("429")) break;
            }
          }
        } catch {
          // League fetch failed — skip to next
        }
      }
    } else {
      squadsSkipped = -1; // Signal: squads are fresh
    }
  }

  // --- Phase 2: Run analysis ---
  let totalOpportunities = 0;
  let clubsAnalyzed = 0;
  let analysisFailed = 0;
  const errors = [];

  try {
    const clubs = await loadClubsWithSnapshots(supabase);

    if (clubs.length === 0) {
      await updatePipelineRun(supabase, runId, { status: "failed", error_log: [{ fatal: "No clubs with squad data" }] });
      return NextResponse.json({
        error: "No clubs with squad data. Click refresh again to fetch more squads.",
        squads_fetched: squadsFetched,
      }, { status: 404 });
    }

    const results = await analyzeBatch(clubs);

    for (const result of results) {
      const club = clubs.find((c) => c.name === result.club_name);
      if (!club) continue;

      try {
        await storeOpportunities(supabase, club.db_id, club.snapshot_id, result.gaps);
        clubsAnalyzed++;
        totalOpportunities += result.gaps.length;
      } catch (err) {
        errors.push({ club: club.name, error: err.message });
        analysisFailed++;
      }
    }

    const finalStatus = analysisFailed > 0 ? "partial" : "completed";
    await updatePipelineRun(supabase, runId, {
      status: finalStatus,
      clubs_processed: clubsAnalyzed,
      clubs_failed: analysisFailed,
      error_log: errors.length > 0 ? errors : null,
    });

    const sources = [...new Set(results.map((r) => r.source).filter(Boolean))];
    return NextResponse.json({
      status: finalStatus,
      squads_fetched: squadsFetched,
      squads_fresh: squadsSkipped === -1,
      clubs_analyzed: clubsAnalyzed,
      opportunities_count: totalOpportunities,
      analysis_source: sources.join(", ") || "unknown",
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    await updatePipelineRun(supabase, runId, {
      status: "failed",
      error_log: [...errors, { fatal: err.message }],
    });

    return NextResponse.json(
      { error: `Refresh failed: ${err.message}`, squads_fetched: squadsFetched },
      { status: 500 }
    );
  }
}
