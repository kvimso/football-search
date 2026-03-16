import { POSITIONS } from "./sample-data.js";

// Parse age range from ideal_profile text
function parseAgeRange(idealProfile) {
  if (!idealProfile) return { min: 20, max: 28 };

  // Try to find explicit age range like "20-25" or "(20-25)"
  const rangeMatch = idealProfile.match(/(\d{2})\s*[-–]\s*(\d{2})/);
  if (rangeMatch) {
    return { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
  }

  // Keywords
  const lower = idealProfile.toLowerCase();
  if (lower.includes("young") || lower.includes("youth")) return { min: 18, max: 23 };
  if (lower.includes("experienced")) return { min: 27, max: 34 };
  if (lower.includes("veteran")) return { min: 30, max: 38 };

  return { min: 20, max: 28 };
}

// Georgian player-friendly leagues (historical transfer patterns)
const GEORGIAN_FRIENDLY_LEAGUES = new Set([
  "Pro League", "Ekstraklasa", "Super League", "Eredivisie", "Serie B",
]);

export function scoreMatch(player, opportunity) {
  let score = 0;
  const factors = [];

  const oppPosition = opportunity.position;

  // Position match (40 or 25 points)
  if (player.primary_position === oppPosition) {
    score += 40;
    factors.push("Primary position match (+40)");
  } else if (player.secondary_position === oppPosition) {
    score += 25;
    factors.push("Secondary position match (+25)");
  } else {
    // No position match at all
    factors.push("Position mismatch (0)");
    return { score: Math.min(score, 100), factors };
  }

  // Age fit (up to 20 points)
  if (player.age) {
    const ageRange = parseAgeRange(opportunity.ideal_profile);
    if (player.age >= ageRange.min && player.age <= ageRange.max) {
      score += 20;
      factors.push(`Age ${player.age} within ideal range ${ageRange.min}-${ageRange.max} (+20)`);
    } else {
      const dist = Math.min(
        Math.abs(player.age - ageRange.min),
        Math.abs(player.age - ageRange.max)
      );
      if (dist <= 3) {
        score += 10;
        factors.push(`Age ${player.age} close to ideal range (+10)`);
      } else {
        factors.push(`Age ${player.age} outside ideal range (0)`);
      }
    }
  }

  // League/budget compatibility (up to 15 points)
  const club = opportunity.clubs;
  const league = club?.league || "";
  const budgetTier = opportunity.budget_tier;

  // Base league compatibility
  let leagueScore = 8;

  // Georgian-friendly league bonus
  if (player.nationality === "Georgia" && GEORGIAN_FRIENDLY_LEAGUES.has(league)) {
    leagueScore += 4;
    factors.push("Georgian-friendly league bonus (+4)");
  }

  // Budget tier alignment
  if (budgetTier === "low" && player.contract_status === "free_agent") {
    leagueScore += 3;
    factors.push("Free agent fits low-budget club (+3)");
  } else if (budgetTier === "high") {
    leagueScore += 2;
  }

  score += Math.min(leagueScore, 15);

  // Contract bonus (up to 5 points)
  if (player.contract_status === "free_agent") {
    score += 5;
    factors.push("Free agent — easy to sign (+5)");
  } else if (player.contract_status === "expiring") {
    score += 3;
    factors.push("Contract expiring — easier to negotiate (+3)");
  }

  return { score: Math.min(score, 100), factors };
}

// Score all players against a single opportunity, return sorted by score DESC
export function scoreAllPlayers(players, opportunity) {
  return players
    .map((player) => ({
      player,
      ...scoreMatch(player, opportunity),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}
