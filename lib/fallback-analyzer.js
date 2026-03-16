// Smart fallback: basic heuristic analysis when no API key
// Extracted to avoid circular dependencies between ai-analyzer and gemini-analyzer

// Map broad API-Football positions to specific sub-positions for counting
const BROAD_TO_SUB = {
  Goalkeeper: ["Goalkeeper"],
  Defender: ["Centre-Back", "Left-Back", "Right-Back"],
  Midfielder: ["Defensive Midfield", "Central Midfield", "Attacking Midfield"],
  Attacker: ["Left Winger", "Right Winger", "Centre-Forward"],
};

export function getFallbackAnalysis(club) {
  const gaps = [];
  const squad = club.squad;

  // Count players by position (both broad and specific)
  const positionCounts = {};
  const positionAges = {};
  const broadCounts = {};

  squad.forEach((p) => {
    const pos = p.sub_position || p.position;
    positionCounts[pos] = (positionCounts[pos] || 0) + 1;
    if (!positionAges[pos]) positionAges[pos] = [];
    positionAges[pos].push({ age: p.age, injured: p.injured, name: p.name });

    // Also track broad position counts
    const broad = p.position;
    broadCounts[broad] = (broadCounts[broad] || 0) + 1;
  });

  // Check each standard position
  const standardPositions = [
    "Centre-Back", "Left-Back", "Right-Back",
    "Defensive Midfield", "Central Midfield", "Attacking Midfield",
    "Left Winger", "Right Winger", "Centre-Forward",
  ];

  // Check if we only have broad positions (API-Football squads endpoint)
  const hasBroadOnly = squad.length > 0 &&
    squad.every((p) => ["Goalkeeper", "Defender", "Midfielder", "Attacker"].includes(p.sub_position || p.position));

  if (hasBroadOnly) {
    // Can't analyze sub-positions — use broad position analysis instead
    return getBroadPositionAnalysis(club, broadCounts, squad);
  }

  standardPositions.forEach((pos) => {
    const count = positionCounts[pos] || 0;
    const players = positionAges[pos] || [];
    const avgAge = players.length > 0 ? players.reduce((s, p) => s + p.age, 0) / players.length : 0;
    const hasInjured = players.some((p) => p.injured);
    const hasOldStarter = players.some((p) => p.age >= 33);

    if (count === 0) {
      gaps.push({
        position: pos,
        urgency: 3,
        reason: `No players registered at ${pos}. Critical gap in squad.`,
        budget_tier: "mid",
        ideal_profile: "Young player (20-25) ready to start immediately",
      });
    } else if (count === 1 && hasInjured) {
      gaps.push({
        position: pos,
        urgency: 3,
        reason: `Only player at ${pos} (${players[0].name}) is injured. No cover.`,
        budget_tier: "mid",
        ideal_profile: "Experienced backup or young talent on loan",
      });
    } else if (count === 1 && hasOldStarter) {
      gaps.push({
        position: pos,
        urgency: 3,
        reason: `Only 1 ${pos} in squad (${players[0].name}, age ${players[0].age}). Aging and no backup.`,
        budget_tier: "mid",
        ideal_profile: `Young replacement (20-25) to phase in over 1-2 seasons`,
      });
    } else if (count === 1) {
      gaps.push({
        position: pos,
        urgency: 2,
        reason: `Only 1 ${pos} in squad (${players[0].name}). Needs backup depth.`,
        budget_tier: "low",
        ideal_profile: "Versatile backup player comfortable in the position",
      });
    } else if (count >= 2 && avgAge > 31) {
      gaps.push({
        position: pos,
        urgency: 2,
        reason: `${count} players at ${pos} but average age is ${avgAge.toFixed(0)}. Aging squad segment.`,
        budget_tier: "mid",
        ideal_profile: "Young talent (19-23) for long-term replacement",
      });
    }
  });

  return gaps;
}

// Analyze using broad positions when sub-positions aren't available
function getBroadPositionAnalysis(club, broadCounts, squad) {
  const gaps = [];
  const squadSize = squad.length;

  // Expected rough distribution for a balanced squad (~25 players)
  // GK: 3, DEF: 8, MID: 8, ATT: 6
  const expectations = [
    { broad: "Defender", min: 6, label: "Defence", positions: ["Centre-Back", "Full-Back"] },
    { broad: "Midfielder", min: 5, label: "Midfield", positions: ["Central Midfield", "Defensive Midfield"] },
    { broad: "Attacker", min: 4, label: "Attack", positions: ["Centre-Forward", "Winger"] },
  ];

  for (const exp of expectations) {
    const count = broadCounts[exp.broad] || 0;
    const players = squad.filter((p) => p.position === exp.broad);
    const avgAge = players.length > 0 ? players.reduce((s, p) => s + (p.age || 0), 0) / players.length : 0;
    const oldPlayers = players.filter((p) => p.age >= 32);
    const injuredPlayers = players.filter((p) => p.injured);

    if (count < exp.min - 2) {
      // Seriously understaffed
      gaps.push({
        position: exp.positions[0],
        urgency: 3,
        reason: `Only ${count} ${exp.label.toLowerCase()}s in squad (expected ${exp.min}+). Critically thin depth.`,
        budget_tier: "mid",
        ideal_profile: "Ready-made starter (22-27) to fill immediate gap",
      });
    } else if (count < exp.min) {
      // Slightly thin
      gaps.push({
        position: exp.positions[0],
        urgency: 2,
        reason: `${count} ${exp.label.toLowerCase()}s in squad — thin for a full season with cups.`,
        budget_tier: "mid",
        ideal_profile: "Versatile player who can cover multiple positions",
      });
    }

    if (oldPlayers.length >= 2 && avgAge > 30) {
      gaps.push({
        position: exp.positions[1] || exp.positions[0],
        urgency: 2,
        reason: `${exp.label} average age is ${avgAge.toFixed(0)} with ${oldPlayers.length} players 32+. Needs youth.`,
        budget_tier: "mid",
        ideal_profile: "Young talent (19-23) for long-term squad renewal",
      });
    }

    if (injuredPlayers.length >= 2) {
      gaps.push({
        position: exp.positions[0],
        urgency: 3,
        reason: `${injuredPlayers.length} ${exp.label.toLowerCase()}s currently injured. Emergency cover needed.`,
        budget_tier: "low",
        ideal_profile: "Short-term loan or free agent to cover injury crisis",
      });
    }
  }

  // If no specific gaps found, note the squad is balanced
  if (gaps.length === 0 && squadSize < 22) {
    gaps.push({
      position: "General",
      urgency: 1,
      reason: `Small squad of ${squadSize} players. Could use depth in any position.`,
      budget_tier: "low",
      ideal_profile: "Versatile squad player for depth",
    });
  }

  return gaps;
}
