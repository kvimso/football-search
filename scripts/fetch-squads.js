#!/usr/bin/env node

// Fetch squad data from API-Football and store in Supabase
// Usage:
//   node scripts/fetch-squads.js                         # Fetch all leagues
//   node scripts/fetch-squads.js --league 144            # Fetch Belgian Pro League only
//   node scripts/fetch-squads.js --resume                # Resume from last checkpoint
//   node scripts/fetch-squads.js --with-injuries         # Include injury data (+1 req/team)
//   node scripts/fetch-squads.js --with-injuries --league 144  # Injuries for one league

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { getCurrentSeason, isApiFootballConfigured, getApiRequestCount } from "../lib/api-football.js";
import { getSupabaseServerClient, isSupabaseConfigured } from "../lib/supabase.js";
import { TARGET_LEAGUES } from "../lib/sample-data.js";
import { logPipelineRun, updatePipelineRun } from "../lib/pipeline-logger.js";
import { runFetchPipeline } from "../lib/data-pipeline.js";

// Load env vars for scripts (not running via Next.js)
import { config } from "dotenv";
config({ path: ".env.local" });

const CHECKPOINT_FILE = "data/fetch-progress.json";

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
    if (data.date === new Date().toISOString().split("T")[0]) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

function saveCheckpoint(leagueIndex, clubIndex, requestCount) {
  if (!existsSync("data")) mkdirSync("data", { recursive: true });
  writeFileSync(
    CHECKPOINT_FILE,
    JSON.stringify({
      leagueIndex,
      clubIndex,
      requestCount,
      date: new Date().toISOString().split("T")[0],
      savedAt: new Date().toISOString(),
    })
  );
}

function clearCheckpoint() {
  if (existsSync(CHECKPOINT_FILE)) {
    writeFileSync(CHECKPOINT_FILE, JSON.stringify({ cleared: true }));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const resumeMode = args.includes("--resume");
  const withInjuries = args.includes("--with-injuries");
  const leagueFlag = args.indexOf("--league");
  const specificLeagueId = leagueFlag >= 0 ? parseInt(args[leagueFlag + 1]) : null;

  console.log("=== FFA Scout Board — Squad Fetcher ===\n");

  // Check configuration
  if (!isApiFootballConfigured()) {
    console.error("ERROR: API_FOOTBALL_KEY not configured.");
    console.error("Add your API key to .env.local");
    process.exit(1);
  }

  const supabase = isSupabaseConfigured() ? getSupabaseServerClient() : null;
  if (!supabase) {
    console.warn("WARNING: Supabase not configured. Data will not be persisted.\n");
  }

  // Determine leagues to fetch
  let leagues = TARGET_LEAGUES;
  if (specificLeagueId) {
    leagues = TARGET_LEAGUES.filter((l) => l.id === specificLeagueId);
    if (leagues.length === 0) {
      console.error(`League ID ${specificLeagueId} not found in TARGET_LEAGUES.`);
      console.error("Available:", TARGET_LEAGUES.map((l) => `${l.id} (${l.name})`).join(", "));
      process.exit(1);
    }
  }

  // Load checkpoint if resuming
  let startFrom = null;
  if (resumeMode) {
    const checkpoint = loadCheckpoint();
    if (checkpoint) {
      startFrom = { leagueIndex: checkpoint.leagueIndex, clubIndex: checkpoint.clubIndex };
      console.log(`Resuming from league ${startFrom.leagueIndex}, club ${startFrom.clubIndex}`);
      console.log(`Previous requests today: ${checkpoint.requestCount}\n`);
    } else {
      console.log("No valid checkpoint found. Starting fresh.\n");
    }
  }

  const season = getCurrentSeason();
  console.log(`Season: ${season}/${season + 1}`);
  console.log(`Leagues: ${leagues.map((l) => l.name).join(", ")}`);
  if (withInjuries) console.log("Injury data: ENABLED (+1 API request per team)");
  console.log();

  // Log pipeline run
  const runId = await logPipelineRun(supabase, {
    runType: "fetch",
    status: "running",
    leaguesProcessed: leagues.map((l) => l.name),
  });

  try {
    // Run the pipeline (core logic in lib/data-pipeline.js)
    const result = await runFetchPipeline(supabase, {
      leagues,
      season,
      withInjuries,
      startFrom,
      onProgress: ({ type, message, step, total }) => {
        switch (type) {
          case "league_start":
            console.log(`\n--- ${message} ---`);
            break;
          case "teams_loaded":
            console.log(message);
            break;
          case "squad_loaded":
          case "squad_retry_ok":
            console.log(`  [${step}/${total}] ${message}`);
            break;
          case "squad_error":
            console.error(`  [${step}/${total}] FAILED — ${message}`);
            break;
        }
      },
    });

    // Handle rate limiting — save checkpoint for resume
    if (result.rateLimited && result.resumePoint) {
      saveCheckpoint(result.resumePoint.leagueIndex, result.resumePoint.clubIndex, result.requestsUsed);
      console.log("\nCheckpoint saved. Run with --resume tomorrow to continue.");
    } else {
      clearCheckpoint();
    }

    // Update pipeline run
    await updatePipelineRun(supabase, runId, {
      status: result.status,
      clubs_processed: result.clubsProcessed,
      clubs_failed: result.clubsFailed,
      error_log: result.errors.length > 0 ? result.errors : null,
    });

    console.log(`\n=== Fetch Complete ===`);
    console.log(`Clubs processed: ${result.clubsProcessed}`);
    console.log(`Clubs failed: ${result.clubsFailed}`);
    console.log(`API requests used: ${result.requestsUsed}`);

    if (result.rateLimited) process.exit(0);
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    await updatePipelineRun(supabase, runId, {
      status: "failed",
      error_log: [{ fatal: err.message }],
    });
    process.exit(1);
  }
}

main();
