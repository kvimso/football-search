#!/usr/bin/env node

// Run AI analysis on squad snapshots and store opportunities in Supabase
// Usage:
//   node scripts/run-analysis.js                # Analyze all clubs with latest snapshots
//   node scripts/run-analysis.js --sample       # Analyze sample data (no Supabase needed)

import { config } from "dotenv";
config({ path: ".env.local" });

import { getSupabaseServerClient, isSupabaseConfigured } from "../lib/supabase.js";
import { analyzeBatchWithGemini } from "../lib/gemini-analyzer.js";
import { SAMPLE_CLUBS } from "../lib/sample-data.js";
import { logPipelineRun, updatePipelineRun } from "../lib/pipeline-logger.js";
import { loadClubsWithSnapshots, storeOpportunities } from "../lib/analysis-pipeline.js";

async function main() {
  const args = process.argv.slice(2);
  const useSampleData = args.includes("--sample");

  console.log("=== FFA Scout Board — Analysis Pipeline ===\n");

  const supabase = isSupabaseConfigured() ? getSupabaseServerClient() : null;

  let clubs;

  if (useSampleData || !supabase) {
    if (!supabase) {
      console.warn("Supabase not configured. Using sample data.\n");
    }
    clubs = SAMPLE_CLUBS;
    console.log(`Using sample data: ${clubs.length} clubs\n`);
  } else {
    // Check for duplicate running pipelines
    const { data: running } = await supabase
      .from("pipeline_runs")
      .select("id")
      .eq("run_type", "analyze")
      .eq("status", "running")
      .limit(1);

    if (running && running.length > 0) {
      console.error("Another analysis pipeline is already running. Aborting.");
      console.error("If this is stale, manually update the pipeline_runs table.");
      process.exit(1);
    }

    console.log("Loading clubs from Supabase...");
    clubs = await loadClubsWithSnapshots(supabase);
    console.log(`Found ${clubs.length} clubs with squad data\n`);
  }

  if (clubs.length === 0) {
    console.error("No clubs to analyze. Run fetch-squads first.");
    process.exit(1);
  }

  // Log pipeline start
  const runId = await logPipelineRun(supabase, { runType: "analyze", status: "running" });

  let totalProcessed = 0;
  let totalFailed = 0;
  let totalOpportunities = 0;
  const errors = [];

  try {
    // Run Gemini batch analysis
    const results = await analyzeBatchWithGemini(clubs);

    // Store results
    for (const result of results) {
      const club = clubs.find((c) => c.name === result.club_name);
      if (!club) continue;

      try {
        if (supabase && club.db_id) {
          await storeOpportunities(supabase, club.db_id, club.snapshot_id, result.gaps);
        }
        totalProcessed++;
        totalOpportunities += result.gaps.length;
        console.log(`  ${club.name}: ${result.gaps.length} gaps (${result.source})`);
      } catch (err) {
        console.error(`  ${club.name}: FAILED to store — ${err.message}`);
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

    console.log(`\n=== Analysis Complete ===`);
    console.log(`Clubs analyzed: ${totalProcessed}`);
    console.log(`Total opportunities: ${totalOpportunities}`);
    console.log(`Failures: ${totalFailed}`);
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    await updatePipelineRun(supabase, runId, {
      status: "failed",
      clubs_processed: totalProcessed,
      clubs_failed: totalFailed,
      error_log: [...errors, { fatal: err.message }],
    });
    process.exit(1);
  }
}

main();
