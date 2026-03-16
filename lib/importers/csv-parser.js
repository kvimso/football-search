// Generic CSV-to-player parser
// Parses CSV text with configurable column mapping

import { normalizePositionOrKeep } from "../position-normalizer.js";

/**
 * Parse CSV text into an array of player objects.
 * @param {string} csvText - Raw CSV string
 * @param {object} columnMap - Maps CSV column headers to player fields
 *   Example: { "Player Name": "name", "Age": "age", "Position": "primary_position" }
 *   If null, uses default 1:1 mapping with snake_case headers.
 * @returns {{ players: object[], errors: { row: number, message: string }[] }}
 */
export function parseCSV(csvText, columnMap = null) {
  const lines = csvText.trim().split("\n").map((l) => l.trim()).filter(Boolean);

  if (lines.length < 2) {
    return { players: [], errors: [{ row: 0, message: "CSV must have a header row and at least one data row" }] };
  }

  const headers = parseCSVLine(lines[0]);
  const players = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i]);
      const raw = {};

      headers.forEach((header, idx) => {
        const field = columnMap ? columnMap[header] : header.toLowerCase().replace(/\s+/g, "_");
        if (field && idx < values.length) {
          raw[field] = values[idx]?.trim() || null;
        }
      });

      const player = normalizePlayerRecord(raw);
      if (!player.name) {
        errors.push({ row: i + 1, message: "Missing required field: name" });
        continue;
      }
      if (!player.primary_position) {
        errors.push({ row: i + 1, message: `Missing or unrecognized position for "${player.name}"` });
        continue;
      }

      players.push(player);
    } catch (err) {
      errors.push({ row: i + 1, message: err.message });
    }
  }

  return { players, errors };
}

/**
 * Parse a single CSV line, handling quoted fields.
 */
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Normalize a raw key-value object into a player record.
 */
function normalizePlayerRecord(raw) {
  return {
    name: raw.name || null,
    age: raw.age ? parseInt(raw.age) : null,
    primary_position: raw.primary_position
      ? normalizePositionOrKeep(raw.primary_position)
      : null,
    secondary_position: raw.secondary_position
      ? normalizePositionOrKeep(raw.secondary_position)
      : null,
    nationality: raw.nationality || "Georgia",
    current_club: raw.current_club || null,
    contract_status: normalizeContractStatus(raw.contract_status),
    contract_until: raw.contract_until || null,
    stats: raw.stats ? tryParseJSON(raw.stats) : {},
    video_links: raw.video_links
      ? (typeof raw.video_links === "string"
        ? raw.video_links.split(";").map((l) => l.trim()).filter(Boolean)
        : raw.video_links)
      : [],
    scouting_notes: raw.scouting_notes || null,
    photo_url: raw.photo_url || null,
    cantera_id: raw.cantera_id || null,
  };
}

function normalizeContractStatus(status) {
  if (!status) return null;
  const lower = status.toLowerCase().trim();
  const map = {
    "free agent": "free_agent",
    "free": "free_agent",
    "free_agent": "free_agent",
    "under contract": "under_contract",
    "contract": "under_contract",
    "under_contract": "under_contract",
    "loan": "loan",
    "on loan": "loan",
    "loaned": "loan",
    "expiring": "expiring",
    "expires": "expiring",
  };
  return map[lower] || null;
}

function tryParseJSON(str) {
  if (typeof str !== "string") return str || {};
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
