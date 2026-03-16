import Anthropic from "@anthropic-ai/sdk";
import { analyzeBatchWithGemini, isGeminiConfigured } from "./gemini-analyzer.js";
import { getFallbackAnalysis } from "./fallback-analyzer.js";

// Re-export for backward compatibility
export { getFallbackAnalysis };

const ANALYSIS_PROMPT = `You are a football transfer analyst working for a Georgian football agency. Your job is to analyze club squads and identify position gaps — opportunities where the club likely needs to sign new players.

IMPORTANT: The squad data may only list broad positions (Defender, Midfielder, Attacker). You MUST use your knowledge of these real players to determine their actual specific positions (Centre-Back, Right-Back, Left-Back, Defensive Midfielder, Central Midfielder, Attacking Midfielder, Left Winger, Right Winger, Centre-Forward, etc.). Analyze gaps at the sub-position level, not broad categories.

For example, a team may have 8 "Defenders" but if you know 6 of them are centre-backs and none are natural left-backs, that's a critical gap at Left-Back.

RULES FOR URGENCY SCORING:
- 3 (CRITICAL): Only 1 player at a key sub-position, OR only starter is 33+, OR key player has long-term injury (3+ months)
- 2 (MEDIUM): 2 players at sub-position but one is aging (31+) or squad depth is thin
- 1 (LOW): Adequate depth but could upgrade quality, or backup is significantly weaker

RULES FOR BUDGET TIER:
- "high": Top clubs in their league, historically big spenders (e.g., Club Brugge, Anderlecht, Lens)
- "mid": Mid-table clubs with moderate transfer budgets
- "low": Smaller clubs, newly promoted, tight budgets

For each club, analyze the full squad and return ONLY a valid JSON array of gap objects. No other text.

Each gap object must have:
{
  "position": "specific position name (e.g., Right-Back, Centre-Forward, Left Winger)",
  "urgency": 1|2|3,
  "reason": "1-2 sentence explanation referencing specific players and why this is a gap",
  "budget_tier": "low"|"mid"|"high",
  "ideal_profile": "brief description of ideal signing (age range, key attributes)"
}

Most clubs have 2-5 meaningful gaps. Return at least 2 gaps per club unless the squad is truly complete.

IMPORTANT: Think about position balance at the sub-position level. Consider aging players needing replacement, injury-prone players, and thin depth at specific positions.`;

export async function analyzeSquad(club) {
  // Fallback chain: Gemini → Claude → Heuristic
  if (isGeminiConfigured()) {
    try {
      const results = await analyzeBatchWithGemini([club]);
      if (results[0]?.gaps) return results[0].gaps;
    } catch (err) {
      console.warn(`Gemini failed for ${club.name}, trying Claude:`, err.message);
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_anthropic_api_key_here") {
    return getFallbackAnalysis(club);
  }

  const client = new Anthropic({ apiKey });

  const squadSummary = club.squad
    .map((p) => {
      let info = `- ${p.name}, Age: ${p.age}, Position: ${p.sub_position || p.position}`;
      if (p.injured) info += ` [INJURED: ${p.injury_type}, return: ${p.return_date}]`;
      return info;
    })
    .join("\n");

  const createParams = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Analyze this squad for ${club.name} (${club.league}, ${club.country}).

SQUAD:
${squadSummary}

Return ONLY the JSON array of position gaps.`,
      },
    ],
    system: ANALYSIS_PROMPT,
  };

  let message;
  try {
    message = await client.messages.create(createParams);
  } catch (err) {
    // Retry once on transient errors (429, 5xx, connection reset)
    if (err.status === 429 || err.status >= 500 || err.code === "ECONNRESET") {
      console.warn(`Claude API error for ${club.name}, retrying in 5s:`, err.message);
      await new Promise((r) => setTimeout(r, 5000));
      try {
        message = await client.messages.create(createParams);
      } catch (retryErr) {
        console.error(`Claude retry failed for ${club.name}:`, retryErr.message);
        return getFallbackAnalysis(club);
      }
    } else {
      console.error(`Claude non-transient error for ${club.name}:`, err.message);
      return getFallbackAnalysis(club);
    }
  }

  const text = message.content[0]?.text || "[]";

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[\s*[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(text);
  } catch (e) {
    console.error(`Failed to parse AI response for ${club.name}:`, text);
    return getFallbackAnalysis(club);
  }
}

export async function analyzeBatch(clubs) {
  // If Gemini is configured, use it for the whole batch
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
          analyzed_at: new Date().toISOString(),
        };
      });
    } catch (err) {
      console.warn("Gemini batch failed, falling back to per-club analysis:", err.message);
    }
  }

  // Fall back to per-club Claude/heuristic analysis
  const results = [];

  for (const club of clubs) {
    try {
      const gaps = await analyzeSquad(club);
      results.push({
        club_id: club.club_id,
        club_name: club.name,
        league: club.league,
        country: club.country,
        logo: club.logo,
        gaps: gaps,
        analyzed_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`Error analyzing ${club.name}:`, err.message);
      results.push({
        club_id: club.club_id,
        club_name: club.name,
        league: club.league,
        country: club.country,
        logo: club.logo,
        gaps: getFallbackAnalysis(club),
        analyzed_at: new Date().toISOString(),
        error: true,
      });
    }

    // Small delay between API calls to respect rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}
