import { POSITIONS } from "./sample-data.js";

// Map common abbreviations and variations to canonical POSITIONS values
const POSITION_MAP = {
  // Goalkeeper
  "gk": "Goalkeeper",
  "keeper": "Goalkeeper",
  "goalie": "Goalkeeper",
  "goal keeper": "Goalkeeper",

  // Centre-Back
  "cb": "Centre-Back",
  "center-back": "Centre-Back",
  "center back": "Centre-Back",
  "centre back": "Centre-Back",
  "central defender": "Centre-Back",
  "stopper": "Centre-Back",

  // Left-Back
  "lb": "Left-Back",
  "left back": "Left-Back",
  "left defender": "Left-Back",
  "left fullback": "Left-Back",
  "left full-back": "Left-Back",
  "lwb": "Left-Back",

  // Right-Back
  "rb": "Right-Back",
  "right back": "Right-Back",
  "right defender": "Right-Back",
  "right fullback": "Right-Back",
  "right full-back": "Right-Back",
  "rwb": "Right-Back",

  // Defensive Midfield
  "cdm": "Defensive Midfield",
  "dm": "Defensive Midfield",
  "defensive midfielder": "Defensive Midfield",
  "defensive midfield": "Defensive Midfield",
  "holding midfielder": "Defensive Midfield",
  "anchor": "Defensive Midfield",

  // Central Midfield
  "cm": "Central Midfield",
  "central midfielder": "Central Midfield",
  "central midfield": "Central Midfield",
  "midfielder": "Central Midfield",
  "midfield": "Central Midfield",

  // Attacking Midfield
  "cam": "Attacking Midfield",
  "am": "Attacking Midfield",
  "attacking midfielder": "Attacking Midfield",
  "attacking midfield": "Attacking Midfield",
  "number 10": "Attacking Midfield",
  "playmaker": "Attacking Midfield",
  "trequartista": "Attacking Midfield",

  // Left Winger
  "lw": "Left Winger",
  "left winger": "Left Winger",
  "left wing": "Left Winger",
  "left forward": "Left Winger",
  "lf": "Left Winger",

  // Right Winger
  "rw": "Right Winger",
  "right winger": "Right Winger",
  "right wing": "Right Winger",
  "right forward": "Right Winger",
  "rf": "Right Winger",

  // Centre-Forward
  "st": "Centre-Forward",
  "cf": "Centre-Forward",
  "striker": "Centre-Forward",
  "centre-forward": "Centre-Forward",
  "center-forward": "Centre-Forward",
  "centre forward": "Centre-Forward",
  "center forward": "Centre-Forward",
  "forward": "Centre-Forward",
  "number 9": "Centre-Forward",

  // Generic position mappings (from API-Football)
  "attacker": "Centre-Forward",
  "defender": "Centre-Back",
};

// Build reverse lookup from canonical positions (lowercased)
const CANONICAL_LOWER = {};
for (const pos of POSITIONS) {
  CANONICAL_LOWER[pos.toLowerCase()] = pos;
}

/**
 * Normalize a position string to a canonical POSITIONS value.
 * Returns the canonical position string, or null if unrecognized.
 */
export function normalizePosition(raw) {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Exact match against canonical positions (case-insensitive)
  const lower = trimmed.toLowerCase();
  if (CANONICAL_LOWER[lower]) return CANONICAL_LOWER[lower];

  // Lookup in abbreviation/variation map
  if (POSITION_MAP[lower]) return POSITION_MAP[lower];

  // Unknown — return null so callers can decide how to handle
  return null;
}

/**
 * Normalize a position, falling back to the raw value if unrecognized.
 * Useful for imports where we want to keep the original rather than discard.
 */
export function normalizePositionOrKeep(raw) {
  return normalizePosition(raw) || (raw ? raw.trim() : null);
}
