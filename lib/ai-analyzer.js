import Anthropic from "@anthropic-ai/sdk";
import { analyzeBatchWithGemini, isGeminiConfigured } from "./gemini-analyzer.js";
import { getFallbackAnalysis } from "./fallback-analyzer.js";

// Re-export for backward compatibility
export { getFallbackAnalysis };

const BATCH_SYSTEM_PROMPT = `You are a football transfer analyst working for a Georgian football agency. Your job is to analyze club squads and identify position gaps — opportunities where the club likely needs to sign new players.

CRITICAL: The squad data lists broad positions (Defender, Midfielder, Attacker). You MUST use your knowledge of these real professional football players to determine their actual specific positions. For example:
- A player listed as "Defender" might actually be a Centre-Back, Right-Back, or Left-Back
- A player listed as "Midfielder" might be a Defensive Midfielder, Central Midfielder, or Attacking Midfielder
- A player listed as "Attacker" might be a Left Winger, Right Winger, or Centre-Forward

Analyze gaps at the SPECIFIC sub-position level. A team with 8 "Defenders" could still have a critical gap if most are centre-backs and there's no natural left-back.

URGENCY SCORING:
- 3 (CRITICAL): Only 0-1 players at a specific sub-position, OR only starter is 33+, OR key player injured long-term
- 2 (MEDIUM): 2 players at a sub-position but one aging (31+) or depth is thin
- 1 (LOW): Adequate depth but could upgrade quality

BUDGET TIER:
- "high": Top clubs, historically big spenders
- "mid": Mid-table clubs with moderate budgets
- "low": Smaller clubs, newly promoted, tight budgets

Return a JSON object where keys are EXACT club names and values are arrays of gap objects.
Each gap: { "position": "Right-Back", "urgency": 3, "reason": "explanation referencing specific players", "budget_tier": "mid", "ideal_profile": "age range, key attributes" }

Every club should have 2-5 gaps. Be specific about which players you're referencing.
Return ONLY valid JSON. No markdown, no code blocks, no commentary.`;

function formatClubsForPrompt(clubs) {
  return clubs
    .map((club) => {
      const squadSummary = club.squad
        .map((p) => {
          let info = `- ${p.name}, Age: ${p.age}, Position: ${p.sub_position || p.position}`;
          if (p.injured) info += ` [INJURED: ${p.injury_type}, return: ${p.return_date}]`;
          return info;
        })
        .join("\n");
      return `\n=== ${club.name} (${club.league}, ${club.country}) ===\nSQUAD:\n${squadSummary}`;
    })
    .join("\n");
}

function validateGap(gap) {
  if (!gap || typeof gap !== "object") return null;
  const urgency = parseInt(gap.urgency);
  if (![1, 2, 3].includes(urgency)) return null;
  const validBudgetTiers = ["low", "mid", "high"];
  let budgetTier = String(gap.budget_tier || "mid").toLowerCase();
  if (budgetTier === "medium" || budgetTier === "moderate") budgetTier = "mid";
  if (!validBudgetTiers.includes(budgetTier)) budgetTier = "mid";
  const position = String(gap.position || "").trim();
  if (!position) return null;
  const reason = String(gap.reason || "").trim();
  if (!reason) return null;
  return {
    position,
    urgency,
    reason,
    budget_tier: budgetTier,
    ideal_profile: String(gap.ideal_profile || "").trim() || null,
  };
}

// Analyze a batch of clubs with Claude in a single API call
async function analyzeClubBatchWithClaude(clubs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_anthropic_api_key_here") {
    return null; // Signal to use fallback
  }

  const client = new Anthropic({ apiKey });
  const clubsText = formatClubsForPrompt(clubs);

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: BATCH_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyze these ${clubs.length} club squads and identify position gaps for each.\n\nReturn a JSON object where keys are club names and values are arrays of gap objects.\nExample: { "FC Nantes": [...gaps], "RC Lens": [...gaps] }\n${clubsText}`,
      },
    ],
  });

  const text = message.content[0]?.text || "{}";

  // Parse JSON from response
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1]);
    } else {
      const objMatch = text.match(/\{[\s\S]*\}/);
      if (objMatch) {
        parsed = JSON.parse(objMatch[0]);
      } else {
        throw new Error("Could not extract JSON from Claude response");
      }
    }
  }

  // Map results back to clubs
  const results = {};
  for (const club of clubs) {
    const clubGaps = parsed[club.name];
    if (Array.isArray(clubGaps)) {
      const validated = clubGaps.map(validateGap).filter(Boolean);
      results[club.name] = validated.slice(0, 5);
    } else {
      results[club.name] = null; // Will use fallback
    }
  }

  return results;
}

// Single-club analysis (kept for backward compatibility)
export async function analyzeSquad(club) {
  if (isGeminiConfigured()) {
    try {
      const results = await analyzeBatchWithGemini([club]);
      if (results[0]?.gaps) return results[0].gaps;
    } catch (err) {
      console.warn(`Gemini failed for ${club.name}, trying Claude:`, err.message);
    }
  }

  try {
    const batchResult = await analyzeClubBatchWithClaude([club]);
    if (batchResult && batchResult[club.name]) {
      return batchResult[club.name];
    }
  } catch (err) {
    console.warn(`Claude failed for ${club.name}:`, err.message);
  }

  return getFallbackAnalysis(club);
}

export async function analyzeBatch(clubs) {
  // Try Gemini first (batch)
  if (isGeminiConfigured()) {
    try {
      const results = await analyzeBatchWithGemini(clubs);
      return results.map((r) => {
        const club = clubs.find((c) => c.name === r.club_name);
        return {
          club_id: club?.club_id,
          club_name: r.club_name,
          league: club?.league,
          country: club?.country,
          logo: club?.logo,
          gaps: r.gaps,
          source: r.source || "gemini",
          analyzed_at: new Date().toISOString(),
        };
      });
    } catch (err) {
      console.warn("Gemini batch failed, trying Claude:", err.message);
    }
  }

  // Try Claude batch (single API call for all clubs)
  try {
    const batchResult = await analyzeClubBatchWithClaude(clubs);
    if (batchResult) {
      return clubs.map((club) => ({
        club_id: club.club_id,
        club_name: club.name,
        league: club.league,
        country: club.country,
        logo: club.logo,
        gaps: batchResult[club.name] || getFallbackAnalysis(club),
        source: batchResult[club.name] ? "claude" : "heuristic",
        analyzed_at: new Date().toISOString(),
      }));
    }
  } catch (err) {
    console.warn("Claude batch failed, using heuristic:", err.message);
  }

  // Fallback to heuristic
  return clubs.map((club) => ({
    club_id: club.club_id,
    club_name: club.name,
    league: club.league,
    country: club.country,
    logo: club.logo,
    gaps: getFallbackAnalysis(club),
    source: "heuristic",
    analyzed_at: new Date().toISOString(),
  }));
}
