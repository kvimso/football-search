// API-Football integration via RapidAPI
// Docs: https://www.api-football.com/documentation-v3

const BASE_URL = "https://v3.football.api-sports.io";

let requestCount = 0;
let lastResetDate = new Date().toDateString();

function getRequestCount() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    requestCount = 0;
    lastResetDate = today;
  }
  return requestCount;
}

function incrementRequestCount() {
  getRequestCount(); // reset if new day
  requestCount++;
  return requestCount;
}

// Rate limiter: max 10 requests per minute
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 6000; // 6 seconds = 10 req/min

async function rateLimitedFetch(url, headers) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const count = incrementRequestCount();
  if (count > 95) {
    throw new Error(
      `API-Football daily limit approaching (${count} requests). Stopping to stay within free tier.`
    );
  }

  const response = await fetch(url, { headers });

  if (response.status === 429) {
    throw new Error("API-Football rate limit reached (429). Try again later.");
  }

  if (!response.ok) {
    throw new Error(`API-Football error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`API-Football API error: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

function getHeaders() {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey || apiKey === "your_api_football_key_here") {
    throw new Error("API_FOOTBALL_KEY not configured. Add it to .env.local");
  }
  return {
    "x-apisports-key": apiKey,
  };
}

// Compute current football season (Aug-May cycle)
export function getCurrentSeason() {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

// Get all teams in a league for a season
export async function getTeamsByLeague(leagueId, season) {
  season = season || getCurrentSeason();
  const url = `${BASE_URL}/teams?league=${leagueId}&season=${season}`;
  const data = await rateLimitedFetch(url, getHeaders());
  return (data.response || []).map((item) => ({
    api_football_id: item.team.id,
    name: item.team.name,
    logo_url: item.team.logo,
    venue: item.venue?.name,
    city: item.venue?.city,
  }));
}

// Get squad for a specific team
export async function getSquad(teamId) {
  const url = `${BASE_URL}/players/squads?team=${teamId}`;
  const data = await rateLimitedFetch(url, getHeaders());
  const squad = data.response?.[0]?.players || [];
  return squad.map(transformPlayer).filter(Boolean);
}

// Transform API-Football player to our sample-data.js shape
function transformPlayer(player) {
  if (!player || !player.name) return null;

  const positionMap = {
    Goalkeeper: "Goalkeeper",
    Defender: "Defender",
    Midfielder: "Midfielder",
    Attacker: "Attacker",
  };

  return {
    api_football_id: player.id || null,
    name: player.name,
    age: player.age || null,
    position: positionMap[player.position] || player.position,
    sub_position: null, // API-Football squads endpoint doesn't provide sub-position
    number: player.number,
    photo: player.photo,
  };
}

// Get injuries for a specific team
export async function getInjuries(teamId, season) {
  season = season || getCurrentSeason();
  const url = `${BASE_URL}/injuries?team=${teamId}&season=${season}`;
  const data = await rateLimitedFetch(url, getHeaders());
  return (data.response || []).map((item) => ({
    player_id: item.player?.id,
    player_name: item.player?.name,
    injury_type: item.player?.reason || item.player?.type || "Unknown",
    return_date: null, // API doesn't always provide return dates
  }));
}

// Merge injury data into a squad array by player API-Football ID
export function mergeInjuries(squad, injuries) {
  if (!injuries || injuries.length === 0) return squad;
  const injuryMap = new Map();
  for (const inj of injuries) {
    if (inj.player_id) injuryMap.set(inj.player_id, inj);
  }
  return squad.map((player) => {
    const injury = player.api_football_id ? injuryMap.get(player.api_football_id) : null;
    if (injury) {
      return { ...player, injured: true, injury_type: injury.injury_type, return_date: injury.return_date };
    }
    return player;
  });
}

// Get current request count (for progress tracking)
export function getApiRequestCount() {
  return getRequestCount();
}

// Check if API-Football is configured
export function isApiFootballConfigured() {
  const key = process.env.API_FOOTBALL_KEY;
  return !!(key && key !== "your_api_football_key_here");
}
