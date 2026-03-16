#!/usr/bin/env node

// Verify AI analysis accuracy by displaying squad data alongside identified gaps
// Usage:
//   node scripts/verify-analysis.js              # Verify from Supabase (10 clubs)
//   node scripts/verify-analysis.js --sample     # Verify using sample data + heuristic

import { config } from "dotenv";
config({ path: ".env.local" });

import { getSupabaseServerClient, isSupabaseConfigured } from "../lib/supabase.js";
import { SAMPLE_CLUBS } from "../lib/sample-data.js";
import { getFallbackAnalysis } from "../lib/fallback-analyzer.js";

const URGENCY_LABELS = { 1: "LOW", 2: "MEDIUM", 3: "CRITICAL" };
const MAX_CLUBS = 10;

function displayClubAnalysis(club, gaps, source) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${club.name} (${club.league}, ${club.country})`);
  console.log(`  Source: ${source}`);
  console.log(`${"=".repeat(70)}`);

  // Show squad summary
  console.log("\n  SQUAD:");
  const byPosition = {};
  club.squad.forEach((p) => {
    const pos = p.sub_position || p.position;
    if (!byPosition[pos]) byPosition[pos] = [];
    byPosition[pos].push(p);
  });

  for (const [pos, players] of Object.entries(byPosition)) {
    const playerList = players
      .map((p) => {
        let s = `${p.name} (${p.age})`;
        if (p.injured) s += ` [INJURED]`;
        if (p.age >= 33) s += ` [AGING]`;
        return s;
      })
      .join(", ");
    console.log(`    ${pos}: ${playerList}`);
  }

  // Show gaps
  console.log(`\n  GAPS IDENTIFIED (${gaps.length}):`);
  if (gaps.length === 0) {
    console.log("    None");
  }

  // Flag suspicious results
  const warnings = [];
  if (gaps.length > 5) warnings.push("WARNING: More than 5 gaps — may be over-flagging");
  if (gaps.length > 0 && gaps.every((g) => g.urgency === 3)) {
    warnings.push("WARNING: All gaps are CRITICAL — suspiciously uniform");
  }

  for (const gap of gaps) {
    const urgencyLabel = URGENCY_LABELS[gap.urgency] || "?";
    console.log(`    [${urgencyLabel}] ${gap.position} (budget: ${gap.budget_tier})`);
    console.log(`         ${gap.reason}`);
    if (gap.ideal_profile) {
      console.log(`         Ideal: ${gap.ideal_profile}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n  ${warnings.join("\n  ")}`);
  }

  // Suggest Transfermarkt verification
  const clubSlug = club.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  console.log(`\n  Verify: https://www.transfermarkt.com/${clubSlug}/startseite/verein/${club.club_id || "search"}`);
}

async function verifyFromSupabase(supabase) {
  // Get clubs with active opportunities
  const { data: clubs } = await supabase
    .from("clubs")
    .select("id, api_football_id, name, league, country")
    .limit(MAX_CLUBS);

  if (!clubs || clubs.length === 0) {
    console.error("No clubs found in database.");
    return;
  }

  for (const club of clubs) {
    // Get latest snapshot
    const { data: snapshots } = await supabase
      .from("squad_snapshots")
      .select("squad_data")
      .eq("club_id", club.id)
      .order("snapshot_date", { ascending: false })
      .limit(1);

    // Get active opportunities
    const { data: opportunities } = await supabase
      .from("opportunities")
      .select("position, urgency, budget_tier, reason, ideal_profile")
      .eq("club_id", club.id)
      .eq("is_active", true)
      .order("urgency", { ascending: false });

    const clubData = {
      club_id: club.api_football_id,
      name: club.name,
      league: club.league,
      country: club.country,
      squad: snapshots?.[0]?.squad_data || [],
    };

    displayClubAnalysis(clubData, opportunities || [], "supabase");
  }
}

async function verifyFromSample() {
  const clubs = SAMPLE_CLUBS.slice(0, MAX_CLUBS);

  for (const club of clubs) {
    const gaps = getFallbackAnalysis(club);
    displayClubAnalysis(club, gaps, "heuristic-fallback");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useSample = args.includes("--sample");

  console.log("=== FFA Scout Board — Analysis Verification ===");
  console.log(`Showing up to ${MAX_CLUBS} clubs for manual review\n`);

  if (useSample || !isSupabaseConfigured()) {
    if (!isSupabaseConfigured()) {
      console.log("Supabase not configured. Using sample data with heuristic analysis.\n");
    }
    await verifyFromSample();
  } else {
    const supabase = getSupabaseServerClient();
    await verifyFromSupabase(supabase);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("Review each club above and compare against Transfermarkt.");
  console.log("Look for: false positives (gaps that don't exist), missed gaps, wrong urgency.");
}

main();
