#!/usr/bin/env node

// Migrate existing free-text player_tags to structured player references
// Matches player_name against the players table (exact match, case-insensitive)
// Safe: does NOT delete or modify player_name — only adds player_id

import { config } from "dotenv";
config({ path: ".env.local" });

import { getSupabaseServerClient, isSupabaseConfigured } from "../lib/supabase.js";

async function main() {
  console.log("=== FFA Scout Board — Tag Migration ===\n");

  if (!isSupabaseConfigured()) {
    console.error("Supabase is not configured. Migration requires a database.");
    process.exit(1);
  }

  const supabase = getSupabaseServerClient();

  // Load all tags without a player_id
  const { data: unmatchedTags, error: tagsErr } = await supabase
    .from("player_tags")
    .select("id, player_name, opportunity_id")
    .is("player_id", null);

  if (tagsErr) {
    console.error("Failed to load tags:", tagsErr.message);
    process.exit(1);
  }

  if (!unmatchedTags || unmatchedTags.length === 0) {
    console.log("No unmatched tags found. All tags already have player_id references.");
    return;
  }

  console.log(`Found ${unmatchedTags.length} tag(s) without player_id\n`);

  // Load all players
  const { data: players, error: playersErr } = await supabase
    .from("players")
    .select("id, name")
    .eq("is_active", true);

  if (playersErr) {
    console.error("Failed to load players:", playersErr.message);
    process.exit(1);
  }

  if (!players || players.length === 0) {
    console.log("No players in database. Add players first, then run migration.");
    console.log("\nUnmatched tags:");
    unmatchedTags.forEach((t) => console.log(`  - "${t.player_name}"`));
    return;
  }

  // Build a case-insensitive lookup map
  const playerLookup = new Map();
  for (const p of players) {
    playerLookup.set(p.name.toLowerCase(), p.id);
  }

  let matched = 0;
  let unmatched = 0;
  const unmatchedNames = [];

  for (const tag of unmatchedTags) {
    const playerId = playerLookup.get(tag.player_name.toLowerCase());

    if (playerId) {
      const { error } = await supabase
        .from("player_tags")
        .update({ player_id: playerId })
        .eq("id", tag.id);

      if (error) {
        console.error(`  Failed to update tag "${tag.player_name}": ${error.message}`);
      } else {
        matched++;
        console.log(`  Matched: "${tag.player_name}" → player_id`);
      }
    } else {
      unmatched++;
      if (!unmatchedNames.includes(tag.player_name)) {
        unmatchedNames.push(tag.player_name);
      }
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Matched: ${matched}`);
  console.log(`Unmatched: ${unmatched}`);

  if (unmatchedNames.length > 0) {
    console.log(`\nUnmatched player names (add these to roster, then re-run):`);
    unmatchedNames.forEach((name) => console.log(`  - "${name}"`));
  }
}

main();
