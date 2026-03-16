// Smart fallback: basic heuristic analysis when no API key
// Extracted to avoid circular dependencies between ai-analyzer and gemini-analyzer

export function getFallbackAnalysis(club) {
  const gaps = [];
  const squad = club.squad;

  // Count players by position
  const positionCounts = {};
  const positionAges = {};

  squad.forEach((p) => {
    const pos = p.sub_position || p.position;
    positionCounts[pos] = (positionCounts[pos] || 0) + 1;
    if (!positionAges[pos]) positionAges[pos] = [];
    positionAges[pos].push({ age: p.age, injured: p.injured, name: p.name });
  });

  // Check each standard position
  const standardPositions = [
    "Centre-Back", "Left-Back", "Right-Back",
    "Defensive Midfield", "Central Midfield", "Attacking Midfield",
    "Left Winger", "Right Winger", "Centre-Forward",
  ];

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
