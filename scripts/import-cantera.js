#!/usr/bin/env node

// Import players from Cantera (Georgian football scouting platform)
// Usage:
//   node scripts/import-cantera.js --csv data/cantera-export.csv
//   node scripts/import-cantera.js --api      (when REST API is configured)

import { config } from "dotenv";
config({ path: ".env.local" });

import { getSupabaseServerClient, isSupabaseConfigured } from "../lib/supabase.js";
import { importFromCSV, importFromAPI, upsertPlayers, markMissingAsInactive } from "../lib/importers/cantera.js";

async function logPipelineRun(supabase, status, clubsProcessed, clubsFailed, errorLog) {
  if (!supabase) return null;
  try {
    const { data } = await supabase.from("pipeline_runs").insert({
      run_type: "cantera_sync",
      status,
      clubs_processed: clubsProcessed,
      clubs_failed: clubsFailed,
      error_log: errorLog,
      completed_at: status !== "running" ? new Date().toISOString() : null,
    }).select("id").single();
    return data?.id || null;
  } catch (err) {
    console.error("Failed to log pipeline run:", err.message);
    return null;
  }
}

async function updatePipelineRun(supabase, runId, updates) {
  if (!supabase || !runId) return;
  try {
    await supabase.from("pipeline_runs").update({
      ...updates,
      completed_at: updates.status !== "running" ? new Date().toISOString() : undefined,
    }).eq("id", runId);
  } catch (err) {
    console.error("Failed to update pipeline run:", err.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const csvIdx = args.indexOf("--csv");
  const useAPI = args.includes("--api");

  console.log("=== FFA Scout Board — Cantera Import ===\n");

  if (!isSupabaseConfigured()) {
    console.error("Supabase is not configured. Cantera import requires a database.");
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = getSupabaseServerClient();
  const runId = await logPipelineRun(supabase, "running", 0, 0, null);

  let importResult;

  try {
    if (csvIdx !== -1) {
      const csvPath = args[csvIdx + 1];
      if (!csvPath) {
        console.error("Usage: --csv <path-to-csv-file>");
        process.exit(1);
      }
      console.log(`Importing from CSV: ${csvPath}\n`);
      importResult = importFromCSV(csvPath);
    } else if (useAPI) {
      const apiUrl = process.env.CANTERA_API_URL;
      const apiKey = process.env.CANTERA_API_KEY;
      console.log("Importing from Cantera API...\n");
      importResult = await importFromAPI(apiUrl, apiKey);
    } else {
      console.error("Specify import source: --csv <path> or --api");
      console.error("\nExamples:");
      console.error("  npm run import-cantera -- --csv data/cantera-players.csv");
      console.error("  npm run import-cantera -- --api");
      process.exit(1);
    }

    console.log(`Parsed ${importResult.players.length} player(s)`);
    if (importResult.errors.length > 0) {
      console.warn(`Parse errors: ${importResult.errors.length}`);
      importResult.errors.forEach((e) => {
        console.warn(`  Row ${e.row}: ${e.message}`);
      });
      console.log();
    }

    if (importResult.players.length === 0) {
      console.error("No valid players to import.");
      await updatePipelineRun(supabase, runId, {
        status: "failed",
        error_log: importResult.errors,
      });
      process.exit(1);
    }

    // Upsert into database
    console.log("Upserting players into database...");
    const upsertResult = await upsertPlayers(supabase, importResult.players);

    console.log(`  Inserted: ${upsertResult.inserted}`);
    console.log(`  Updated: ${upsertResult.updated}`);
    if (upsertResult.errors.length > 0) {
      console.warn(`  Errors: ${upsertResult.errors.length}`);
      upsertResult.errors.forEach((e) => {
        console.warn(`    ${e.player}: ${e.error}`);
      });
    }

    // Mark missing Cantera players as inactive
    const importedIds = importResult.players
      .map((p) => p.cantera_id)
      .filter(Boolean);
    if (importedIds.length > 0) {
      await markMissingAsInactive(supabase, importedIds);
    }

    const totalProcessed = upsertResult.inserted + upsertResult.updated;
    const totalFailed = upsertResult.errors.length + importResult.errors.length;
    const allErrors = [...importResult.errors, ...upsertResult.errors];

    await updatePipelineRun(supabase, runId, {
      status: totalFailed > 0 ? "partial" : "completed",
      clubs_processed: totalProcessed,
      clubs_failed: totalFailed,
      error_log: allErrors.length > 0 ? allErrors : null,
    });

    console.log(`\n=== Cantera Import Complete ===`);
    console.log(`Total imported: ${totalProcessed}`);
    console.log(`Total errors: ${totalFailed}`);
    console.log("\nRun 'npm run run-matching' to generate match scores for imported players.");
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
