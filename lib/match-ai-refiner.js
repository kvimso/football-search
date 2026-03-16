import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import { isGeminiConfigured } from "./gemini-analyzer.js";

const MATCHING_PROMPT = `You are a football transfer matching analyst working for a Georgian football agency. Given a club's transfer opportunity and a list of candidate players, evaluate each player's fit.

For each player, return a JSON object with:
{
  "player_name": "exact name as provided",
  "score": 0-100,
  "reasoning": "2-3 sentence explanation of why this player fits or doesn't fit this opportunity"
}

Scoring guidelines:
- 90-100: Perfect fit — right position, ideal age, stats and style match, league level appropriate
- 70-89: Strong fit — position matches, minor gaps (age slightly off, stats adequate but not exceptional)
- 50-69: Moderate fit — can play the position but not primary, or other significant gaps
- 30-49: Weak fit — significant mismatches but not impossible
- 0-29: Poor fit — wrong position, wrong profile, unrealistic move

Return ONLY a valid JSON array of objects. No other text.`;

function formatOpportunity(opportunity) {
  const club = opportunity.clubs || {};
  return `OPPORTUNITY:
Club: ${club.name || "Unknown"} (${club.league || "Unknown"}, ${club.country || "Unknown"})
Position needed: ${opportunity.position}
Urgency: ${opportunity.urgency}/3
Budget tier: ${opportunity.budget_tier}
AI reasoning: ${opportunity.reason || "N/A"}
Ideal profile: ${opportunity.ideal_profile || "N/A"}`;
}

function formatPlayers(players) {
  return players.map((p) => {
    let info = `- ${p.name}, age ${p.age || "unknown"}, position: ${p.primary_position}`;
    if (p.secondary_position) info += ` (secondary: ${p.secondary_position})`;
    if (p.current_club) info += `\n  Current club: ${p.current_club}`;
    if (p.contract_status) info += `, contract: ${p.contract_status}`;
    if (p.stats && Object.keys(p.stats).length > 0) {
      info += `\n  Stats: ${JSON.stringify(p.stats)}`;
    }
    if (p.scouting_notes) info += `\n  Scouting notes: ${p.scouting_notes}`;
    return info;
  }).join("\n\n");
}

// Refine matches using Gemini
async function refineWithGemini(opportunity, candidates) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `${formatOpportunity(opportunity)}

CANDIDATE PLAYERS:
${formatPlayers(candidates)}

Score each player and explain the fit. Return a JSON array.`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: MATCHING_PROMPT }] },
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  });

  const text = result.response.text();
  return parseAIResponse(text);
}

// Refine matches using Claude (fallback)
async function refineWithClaude(opportunity, candidates) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_anthropic_api_key_here") {
    return null;
  }

  const client = new Anthropic({ apiKey });

  const prompt = `${formatOpportunity(opportunity)}

CANDIDATE PLAYERS:
${formatPlayers(candidates)}

Score each player and explain the fit. Return ONLY a JSON array.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
    system: MATCHING_PROMPT,
  });

  const text = message.content[0]?.text || "[]";
  return parseAIResponse(text);
}

function parseAIResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);

    // Try finding a JSON array
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) return JSON.parse(arrMatch[0]);

    return null;
  }
}

/**
 * Refine match scores using AI. Follows fallback chain: Gemini → Claude → return null.
 * Returns array of { player_name, score, reasoning } or null if all AI sources fail.
 */
export async function refineMatches(opportunity, candidates) {
  // Try Gemini first
  if (isGeminiConfigured()) {
    try {
      const results = await refineWithGemini(opportunity, candidates);
      if (results && Array.isArray(results) && results.length > 0) {
        return results;
      }
    } catch (err) {
      console.warn(`Gemini matching failed for ${opportunity.clubs?.name || "unknown"}: ${err.message}`);
    }
  }

  // Try Claude
  try {
    const results = await refineWithClaude(opportunity, candidates);
    if (results && Array.isArray(results) && results.length > 0) {
      return results;
    }
  } catch (err) {
    console.warn(`Claude matching failed: ${err.message}`);
  }

  // Both failed — caller keeps heuristic scores
  return null;
}
