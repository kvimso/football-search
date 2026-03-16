// Team cache: reads data/league-teams.json to avoid burning API requests on team lists
// Cache is invalidated if older than maxAgeDays or if season doesn't match

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "..", "data", "league-teams.json");

/**
 * Load cached teams for a specific league (or all leagues).
 * Returns null if cache is stale, missing, or wrong season.
 */
export function loadTeamCache(leagueId, { maxAgeDays = 30, expectedSeason } = {}) {
  try {
    if (!existsSync(CACHE_FILE)) return null;

    const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    if (!cache.fetched_at || !cache.leagues) return null;

    // Check season
    if (expectedSeason && cache.season !== expectedSeason) return null;

    // Check age
    const fetchedDate = new Date(cache.fetched_at);
    const ageMs = Date.now() - fetchedDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > maxAgeDays) return null;

    if (leagueId) {
      const league = cache.leagues[String(leagueId)];
      if (!league || !league.teams || league.teams.length === 0) return null;

      // Transform to match getTeamsByLeague() output shape
      return league.teams.map((t) => ({
        api_football_id: t.id,
        name: t.name,
        logo_url: `https://media.api-sports.io/football/teams/${t.id}.png`,
      }));
    }

    // Return all leagues
    return cache;
  } catch {
    return null;
  }
}

/**
 * Save team data to cache file.
 * @param {object} data - Full cache object with fetched_at, season, leagues
 */
export function saveTeamCache(data) {
  const dir = dirname(CACHE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}
