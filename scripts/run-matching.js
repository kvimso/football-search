#!/usr/bin/env node

// Run matching engine: score players against opportunities
// Usage:
//   node scripts/run-matching.js                    # Match all players against all active opportunities
//   node scripts/run-matching.js --sample            # Match sample players against sample opportunities
//   node scripts/run-matching.js --player <id>       # Match specific player against all opportunities
//   node scripts/run-matching.js --opportunity <id>  # Match all players against specific opportunity

import { config } from "dotenv";
config({ path: ".env.local" });

import { getSupabaseServerClient, isSupabaseConfigured } from "../lib/supabase.js";
import { SAMPLE_CLUBS } from "../lib/sample-data.js";
import { SAMPLE_PLAYERS } from "../lib/sample-players.js";
import { getFallbackAnalysis } from "../lib/fallback-analyzer.js";
import { scoreAllPlayers } from "../lib/match-engine.js";
import { refineMatches } from "../lib/match-ai-refiner.js";
import { logPipelineRun, updatePipelineRun } from "../lib/pipeline-logger.js";

const TOP_N_FOR_AI = 10;

async function loadPlayers(supabase, playerId) {
  if (!supabase) return SAMPLE_PLAYERS;

  let query = supabase.from("players").select("*").eq("is_active", true);
  if (playerId) query = query.eq("id", playerId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load players: ${error.message}`);
  return data || [];
}

async function loadOpportunities(supabase, opportunityId) {
  if (!supabase) {
    // Generate from sample data
    return SAMPLE_CLUBS.flatMap((club) => {
      const gaps = getFallbackAnalysis(club);
      return gaps.map((gap, i) => ({
        id: `${club.club_id}-${i}`,
        position: gap.position,
        urgency: gap.urgency,
        budget_tier: gap.budget_tier,
        reason: gap.reason,
        ideal_profile: gap.ideal_profile,
        clubs: {
          id: club.club_id,
          name: club.name,
          league: club.league,
          country: club.country,
        },
      }));
    });
  }

  let query = supabase
    .from("opportunities")
    .select(`
      id, position, urgency, budget_tier, reason, ideal_profile,
      clubs!inner(id, name, logo_url, league, country)
    `)
    .eq("is_active", true)
    .order("urgency", { ascending: false });

  if (opportunityId) query = query.eq("id", opportunityId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load opportunities: ${error.message}`);
  return data || [];
}

async function storeMatches(supabase, matches) {
  if (!supabase || matches.length === 0) return;

  // Upsert: on conflict (player_id, opportunity_id), update score and reasoning
  // But preserve is_confirmed and is_dismissed
  for (const match of matches) {
    const { error } = await supabase
      .from("player_matches")
      .upsert({
        player_id: match.player_id,
        opportunity_id: match.opportunity_id,
        match_score: match.match_score,
        match_reasoning: match.match_reasoning || null,
        source: match.source,
      }, {
        onConflict: "player_id,opportunity_id",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`  Failed to store match: ${error.message}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useSampleData = args.includes("--sample");
  const playerIdIdx = args.indexOf("--player");
  const oppIdIdx = args.indexOf("--opportunity");
  const playerId = playerIdIdx !== -1 ? args[playerIdIdx + 1] : null;
  const opportunityId = oppIdIdx !== -1 ? args[oppIdIdx + 1] : null;

  console.log("=== FFA Scout Board — Matching Pipeline ===\n");

  const supabase = (isSupabaseConfigured() && !useSampleData) ? getSupabaseServerClient() : null;

  if (!supabase) {
    console.log(useSampleData ? "Using sample data.\n" : "Supabase not configured. Using sample data.\n");
  }

  // Load data
  console.log("Loading players...");
  const players = await loadPlayers(supabase, playerId);
  console.log(`  Found ${players.length} player(s)\n`);

  if (players.length === 0) {
    console.error("No players found. Add players first.");
    process.exit(1);
  }

  console.log("Loading opportunities...");
  const opportunities = await loadOpportunities(supabase, opportunityId);
  console.log(`  Found ${opportunities.length} opportunity(ies)\n`);

  if (opportunities.length === 0) {
    console.error("No active opportunities found. Run analysis first.");
    process.exit(1);
  }

  // Log pipeline start
  const runId = await logPipelineRun(supabase, { runType: "match", status: "running" });

  let totalMatches = 0;
  let totalOpportunities = 0;
  let totalFailed = 0;
  const errors = [];

  try {
    for (const opportunity of opportunities) {
      const clubName = opportunity.clubs?.name || "Unknown";
      totalOpportunities++;

      // Step 1: Heuristic scoring
      const heuristicResults = scoreAllPlayers(players, opportunity);

      if (heuristicResults.length === 0) {
        console.log(`  ${clubName} — ${opportunity.position}: no position matches`);
        continue;
      }

      // Step 2: Take top N for AI refinement
      const topCandidates = heuristicResults.slice(0, TOP_N_FOR_AI);

      let matchResults;
      try {
        // Step 3: AI refinement
        const aiResults = await refineMatches(
          opportunity,
          topCandidates.map((c) => c.player)
        );

        if (aiResults) {
          // Merge AI scores with heuristic data
          matchResults = topCandidates.map((candidate) => {
            const aiResult = aiResults.find(
              (r) => r.player_name?.toLowerCase() === candidate.player.name.toLowerCase()
            );
            return {
              player_id: candidate.player.id,
              opportunity_id: opportunity.id,
              match_score: aiResult?.score ?? candidate.score,
              match_reasoning: aiResult?.reasoning || candidate.factors.join(". "),
              source: aiResult ? "gemini" : "heuristic",
            };
          });
        } else {
          // Use heuristic scores only
          matchResults = topCandidates.map((candidate) => ({
            player_id: candidate.player.id,
            opportunity_id: opportunity.id,
            match_score: candidate.score,
            match_reasoning: candidate.factors.join(". "),
            source: "heuristic",
          }));
        }
      } catch (err) {
        console.warn(`  AI refinement failed for ${clubName}: ${err.message}`);
        errors.push({ opportunity: `${clubName} - ${opportunity.position}`, error: err.message });

        // Fallback to heuristic
        matchResults = topCandidates.map((candidate) => ({
          player_id: candidate.player.id,
          opportunity_id: opportunity.id,
          match_score: candidate.score,
          match_reasoning: candidate.factors.join(". "),
          source: "heuristic",
        }));
      }

      // Store matches
      await storeMatches(supabase, matchResults);
      totalMatches += matchResults.length;

      const topScore = matchResults[0]?.match_score || 0;
      const source = matchResults[0]?.source || "heuristic";
      console.log(`  ${clubName} — ${opportunity.position}: ${matchResults.length} matches (top: ${topScore}, ${source})`);

      // Small delay between AI calls
      if (supabase) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const finalStatus = totalFailed > 0 ? "partial" : "completed";
    await updatePipelineRun(supabase, runId, {
      status: finalStatus,
      clubs_processed: totalOpportunities,
      clubs_failed: totalFailed,
      error_log: errors.length > 0 ? errors : null,
    });

    console.log(`\n=== Matching Complete ===`);
    console.log(`Opportunities scored: ${totalOpportunities}`);
    console.log(`Total matches generated: ${totalMatches}`);
    console.log(`AI failures (fell back to heuristic): ${errors.length}`);
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    await updatePipelineRun(supabase, runId, {
      status: "failed",
      clubs_processed: totalOpportunities,
      clubs_failed: totalFailed,
      error_log: [...errors, { fatal: err.message }],
    });
    process.exit(1);
  }
}

main();
