import { GoogleGenerativeAI } from "@google/generative-ai";
import { getFallbackAnalysis } from "./fallback-analyzer.js";

const BATCH_SIZE = 25;

const ANALYSIS_PROMPT = `You are a football transfer analyst working for a Georgian football agency. Your job is to analyze club squads and identify position gaps — opportunities where the club likely needs to sign new players.

RULES FOR URGENCY SCORING:
- 3 (CRITICAL): Only 1 player at a key position, OR only starter is 33+, OR key player has long-term injury (3+ months)
- 2 (MEDIUM): 2 players but one is aging (31+) or squad depth is thin for a position
- 1 (LOW): Adequate depth but could upgrade quality, or backup is significantly weaker

RULES FOR BUDGET TIER:
- "high": Top clubs in their league, historically big spenders
- "mid": Mid-table clubs with moderate transfer budgets
- "low": Smaller clubs, newly promoted, tight budgets

For each club provided, analyze the full squad and return a JSON object with the club name as key and an array of gap objects as value.

Each gap object must have:
{
  "position": "specific position name (e.g., Right-Back, Centre-Forward, Left Winger)",
  "urgency": 1|2|3,
  "reason": "1-2 sentence explanation of why this is a gap",
  "budget_tier": "low"|"mid"|"high",
  "ideal_profile": "brief description of ideal signing (age range, key attributes)"
}

Return ONLY valid JSON. No other text, no markdown code blocks.

IMPORTANT: Think about position balance. A squad with 3 centre-backs but 0 left-backs has a critical gap. A squad with aging players at key positions needs younger replacements. Consider injuries.`;

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

// Validate a single gap object
function validateGap(gap) {
  if (!gap || typeof gap !== "object") return null;

  const urgency = parseInt(gap.urgency);
  if (![1, 2, 3].includes(urgency)) return null;

  const validBudgetTiers = ["low", "mid", "high"];
  let budgetTier = String(gap.budget_tier || "mid").toLowerCase();
  // Normalize common AI variations
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

// Analyze a batch of clubs with Gemini
async function analyzeClubBatch(genAI, clubs) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const clubsText = formatClubsForPrompt(clubs);
  const clubNames = clubs.map((c) => c.name);

  const prompt = `Analyze these ${clubs.length} club squads and identify position gaps for each.

Return a JSON object where keys are club names and values are arrays of gap objects.
Example: { "FC Nantes": [...gaps], "RC Lens": [...gaps] }

${clubsText}`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: ANALYSIS_PROMPT }] },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
    },
  });

  const text = result.response.text();

  // Extract JSON from response
  let parsed;
  try {
    // Try direct parse first
    parsed = JSON.parse(text);
  } catch {
    // Try extracting JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1]);
    } else {
      // Try finding a JSON object
      const objMatch = text.match(/\{[\s\S]*\}/);
      if (objMatch) {
        parsed = JSON.parse(objMatch[0]);
      } else {
        throw new Error("Could not extract JSON from Gemini response");
      }
    }
  }

  // Map results back to clubs with validation
  const results = {};
  for (const club of clubs) {
    const clubGaps = parsed[club.name];
    if (Array.isArray(clubGaps)) {
      const validated = clubGaps.map(validateGap).filter(Boolean);
      // Cap at 5 gaps per club to prevent over-flagging
      results[club.name] = validated.slice(0, 5);
    } else {
      // Club not found in response — log and use fallback
      console.warn(`  Gemini did not return results for ${club.name}, using fallback`);
      results[club.name] = getFallbackAnalysis(club);
    }
  }

  return results;
}

// Main batch analysis function
export async function analyzeBatchWithGemini(clubs) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    console.warn("GEMINI_API_KEY not configured. Using fallback heuristic analysis.");
    return clubs.map((club) => ({
      club_name: club.name,
      gaps: getFallbackAnalysis(club),
      source: "heuristic",
    }));
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const allResults = [];

  // Split into batches
  const batches = [];
  for (let i = 0; i < clubs.length; i += BATCH_SIZE) {
    batches.push(clubs.slice(i, i + BATCH_SIZE));
  }

  console.log(`Processing ${clubs.length} clubs in ${batches.length} batch(es) of up to ${BATCH_SIZE}...`);

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    console.log(`\n  Batch ${bi + 1}/${batches.length}: ${batch.map((c) => c.name).join(", ")}`);

    try {
      const batchResults = await analyzeClubBatch(genAI, batch);

      for (const club of batch) {
        allResults.push({
          club_name: club.name,
          gaps: batchResults[club.name] || getFallbackAnalysis(club),
          source: batchResults[club.name] ? "gemini" : "heuristic",
        });
      }
    } catch (err) {
      console.error(`  Batch ${bi + 1} failed: ${err.message}`);

      // If rate limited, wait and retry once
      if (err.message.includes("429") || err.message.includes("quota")) {
        console.log("  Rate limited. Waiting 60s before retry...");
        await new Promise((r) => setTimeout(r, 60000));

        try {
          const batchResults = await analyzeClubBatch(genAI, batch);
          for (const club of batch) {
            allResults.push({
              club_name: club.name,
              gaps: batchResults[club.name] || getFallbackAnalysis(club),
              source: batchResults[club.name] ? "gemini" : "heuristic",
            });
          }
          continue;
        } catch (retryErr) {
          console.error(`  Retry also failed: ${retryErr.message}`);
        }
      }

      // Fall back to heuristic for the entire batch
      for (const club of batch) {
        allResults.push({
          club_name: club.name,
          gaps: getFallbackAnalysis(club),
          source: "heuristic",
        });
      }
    }

    // Small delay between batches
    if (bi < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return allResults;
}

// Check if Gemini is configured
export function isGeminiConfigured() {
  const key = process.env.GEMINI_API_KEY;
  return !!(key && key !== "your_gemini_api_key_here");
}
