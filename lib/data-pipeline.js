// Core data pipeline functions — importable from scripts or API routes
// No process.exit(), no dotenv, no console.log (uses callbacks for progress)

import { getTeamsByLeague, getSquad, getInjuries, mergeInjuries, getCurrentSeason, getApiRequestCount } from "./api-football.js";
import { loadTeamCache } from "./team-cache.js";

/**
 * Fetch teams for a league, checking cache first.
 * @returns {{ teams: Array, fromCache: boolean }}
 */
export async function fetchTeamsForLeague(leagueId, season, { useCache = true } = {}) {
  if (useCache) {
    const cached = loadTeamCache(leagueId, { maxAgeDays: 30, expectedSeason: season });
    if (cached) {
      return { teams: cached, fromCache: true };
    }
  }
  const teams = await getTeamsByLeague(leagueId, season);
  return { teams, fromCache: false };
}

/**
 * Fetch squad for a team, optionally with injury data.
 * @returns {{ squad: Array, requestsUsed: number }}
 */
export async function fetchSquadForTeam(teamId, { withInjuries = false, season } = {}) {
  let squad = await getSquad(teamId);
  let requestsUsed = 1;

  if (withInjuries) {
    try {
      const injuries = await getInjuries(teamId, season);
      squad = mergeInjuries(squad, injuries);
      requestsUsed = 2;
    } catch {
      // Injury fetch failure is non-fatal — continue with squad only
    }
  }

  return { squad, requestsUsed };
}

/**
 * Upsert a club and its squad snapshot into Supabase.
 * @returns {{ clubId: string, snapshotId: string|null }}
 */
export async function upsertClubAndSnapshot(supabase, { club, league, squad }) {
  const { data, error } = await supabase
    .from("clubs")
    .upsert(
      {
        api_football_id: club.api_football_id,
        name: club.name,
        league: league.name,
        country: league.country,
        logo_url: club.logo_url,
      },
      { onConflict: "api_football_id" }
    )
    .select("id")
    .single();

  if (error) throw new Error(`Failed to upsert club ${club.name}: ${error.message}`);
  const clubId = data.id;

  const today = new Date().toISOString().split("T")[0];
  const { error: snapError } = await supabase.from("squad_snapshots").upsert(
    {
      club_id: clubId,
      snapshot_date: today,
      squad_data: squad,
      player_count: squad.length,
    },
    { onConflict: "club_id,snapshot_date" }
  );
  if (snapError) throw new Error(`Failed to insert snapshot: ${snapError.message}`);

  return { clubId };
}

/**
 * Run the full fetch pipeline.
 * Does NOT call process.exit() — returns results.
 *
 * @param {object} supabase - Supabase client (or null for dry run)
 * @param {object} options
 * @param {Array} options.leagues - Array of { id, name, country, flag }
 * @param {number} options.season
 * @param {boolean} options.withInjuries
 * @param {function} options.onProgress - ({ type, message, league?, team?, step?, total? }) => void
 * @param {object} options.startFrom - { leagueIndex, clubIndex } for resume
 * @returns {{ status: string, clubsProcessed: number, clubsFailed: number, errors: Array, rateLimited: boolean, resumePoint?: { leagueIndex, clubIndex } }}
 */
export async function runFetchPipeline(supabase, {
  leagues,
  season,
  withInjuries = false,
  onProgress = () => {},
  startFrom = null,
}) {
  season = season || getCurrentSeason();

  let totalClubs = 0;
  let totalFailed = 0;
  const errors = [];
  let rateLimited = false;
  let resumePoint = null;

  const startLeagueIdx = startFrom?.leagueIndex || 0;
  const startClubIdx = startFrom?.clubIndex || 0;

  for (let li = startLeagueIdx; li < leagues.length; li++) {
    const league = leagues[li];
    onProgress({ type: "league_start", message: `${league.flag} ${league.name} (${league.country})`, league: league.name });

    // Fetch teams
    let teams;
    try {
      const result = await fetchTeamsForLeague(league.id, season);
      teams = result.teams;
      onProgress({ type: "teams_loaded", message: `Found ${teams.length} teams${result.fromCache ? " (cached)" : ""}`, league: league.name, total: teams.length });
    } catch (err) {
      errors.push({ league: league.name, error: err.message });
      if (err.message.includes("daily limit") || err.message.includes("429")) {
        rateLimited = true;
        resumePoint = { leagueIndex: li, clubIndex: 0 };
        break;
      }
      continue;
    }

    // Fetch squads
    const clubStartIdx = li === startLeagueIdx ? startClubIdx : 0;
    for (let ci = clubStartIdx; ci < teams.length; ci++) {
      const team = teams[ci];
      try {
        const { squad } = await fetchSquadForTeam(team.api_football_id, { withInjuries, season });
        const injuredCount = squad.filter((p) => p.injured).length;

        onProgress({
          type: "squad_loaded",
          message: `${team.name}: ${squad.length} players${injuredCount > 0 ? `, ${injuredCount} injured` : ""}`,
          league: league.name,
          team: team.name,
          step: ci + 1,
          total: teams.length,
        });

        if (supabase) {
          await upsertClubAndSnapshot(supabase, { club: team, league, squad });
        }

        totalClubs++;
      } catch (err) {
        errors.push({ club: team.name, league: league.name, error: err.message });
        totalFailed++;

        onProgress({ type: "squad_error", message: `${team.name}: ${err.message}`, league: league.name, team: team.name, step: ci + 1, total: teams.length });

        if (err.message.includes("daily limit") || err.message.includes("429")) {
          rateLimited = true;
          resumePoint = { leagueIndex: li, clubIndex: ci };
          break;
        }

        // Retry once for 5xx server errors
        if (/\b5\d{2}\b/.test(err.message)) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const { squad } = await fetchSquadForTeam(team.api_football_id, { withInjuries, season });
            if (supabase) {
              await upsertClubAndSnapshot(supabase, { club: team, league, squad });
            }
            totalClubs++;
            totalFailed--;
            onProgress({ type: "squad_retry_ok", message: `${team.name}: ${squad.length} players (retry)`, league: league.name, team: team.name });
          } catch {
            // Already counted as failed
          }
        }
      }
    }

    if (rateLimited) break;
  }

  const status = rateLimited ? "partial" : totalFailed > 0 ? "partial" : "completed";

  return {
    status,
    clubsProcessed: totalClubs,
    clubsFailed: totalFailed,
    errors,
    rateLimited,
    resumePoint,
    requestsUsed: getApiRequestCount(),
  };
}
