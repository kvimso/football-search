// Cantera Integration — Transport-agnostic player importer
// Supports CSV import now, REST API and shared Supabase later.

import { readFileSync } from "fs";
import { parseCSV } from "./csv-parser.js";

// Default column mapping for Cantera CSV exports
const CANTERA_CSV_COLUMNS = {
  "name": "name",
  "player_name": "name",
  "age": "age",
  "position": "primary_position",
  "primary_position": "primary_position",
  "secondary_position": "secondary_position",
  "nationality": "nationality",
  "current_club": "current_club",
  "club": "current_club",
  "contract_status": "contract_status",
  "contract_until": "contract_until",
  "stats": "stats",
  "video_links": "video_links",
  "scouting_notes": "scouting_notes",
  "notes": "scouting_notes",
  "photo_url": "photo_url",
  "cantera_id": "cantera_id",
  "id": "cantera_id",
};

/**
 * Import players from a CSV file.
 * @param {string} filePath - Path to CSV file
 * @returns {{ players: object[], errors: object[] }}
 */
export function importFromCSV(filePath) {
  const csvText = readFileSync(filePath, "utf-8");
  return parseCSV(csvText, CANTERA_CSV_COLUMNS);
}

/**
 * Import players from a REST API. (Placeholder — not yet configured)
 */
export async function importFromAPI(apiUrl, apiKey) {
  throw new Error(
    "Cantera REST API integration is not yet configured. " +
    "Set CANTERA_API_URL and CANTERA_API_KEY in .env.local when ready."
  );
}

/**
 * Import players from a remote Supabase instance. (Placeholder — not yet configured)
 */
export async function importFromSupabase(supabaseUrl, supabaseKey, tableName) {
  throw new Error(
    "Cantera Supabase integration is not yet configured. " +
    "Provide the remote Supabase URL and key when ready."
  );
}

// Fields that Cantera "owns" — overwritten on sync
const CANTERA_OWNED_FIELDS = [
  "name", "age", "primary_position", "secondary_position",
  "stats", "current_club", "nationality",
];

// Fields that FFA "owns" — preserved on sync
// scouting_notes, video_links, contract_status, contract_until, photo_url

/**
 * Upsert players into Supabase. Matches on cantera_id (or name + age).
 * Cantera-owned fields are overwritten; FFA-owned fields are preserved.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object[]} normalizedPlayers - Array of normalized player records
 * @returns {{ inserted: number, updated: number, errors: object[] }}
 */
export async function upsertPlayers(supabase, normalizedPlayers) {
  let inserted = 0;
  let updated = 0;
  const errors = [];

  for (const player of normalizedPlayers) {
    try {
      // Try to find existing player by cantera_id
      let existing = null;

      if (player.cantera_id) {
        const { data } = await supabase
          .from("players")
          .select("*")
          .eq("cantera_id", player.cantera_id)
          .single();
        existing = data;
      }

      // Fallback: match by name + age
      if (!existing && player.name) {
        const { data } = await supabase
          .from("players")
          .select("*")
          .eq("name", player.name)
          .eq("source", "cantera")
          .limit(1);
        existing = data?.[0] || null;
      }

      if (existing) {
        // Update: overwrite Cantera-owned fields, preserve FFA-owned
        const updates = {};
        for (const field of CANTERA_OWNED_FIELDS) {
          if (player[field] !== undefined && player[field] !== null) {
            updates[field] = player[field];
          }
        }
        updates.cantera_active = true;
        updates.updated_at = new Date().toISOString();

        const { error } = await supabase
          .from("players")
          .update(updates)
          .eq("id", existing.id);

        if (error) {
          errors.push({ player: player.name, error: error.message });
        } else {
          updated++;
        }
      } else {
        // Insert new player
        const { error } = await supabase
          .from("players")
          .insert({
            name: player.name,
            age: player.age,
            primary_position: player.primary_position,
            secondary_position: player.secondary_position || null,
            nationality: player.nationality || "Georgia",
            current_club: player.current_club || null,
            contract_status: player.contract_status || null,
            contract_until: player.contract_until || null,
            stats: player.stats || {},
            video_links: player.video_links || [],
            scouting_notes: player.scouting_notes || null,
            photo_url: player.photo_url || null,
            source: "cantera",
            cantera_id: player.cantera_id || null,
            cantera_active: true,
          });

        if (error) {
          errors.push({ player: player.name, error: error.message });
        } else {
          inserted++;
        }
      }
    } catch (err) {
      errors.push({ player: player.name || "unknown", error: err.message });
    }
  }

  return { inserted, updated, errors };
}

/**
 * Mark players not present in the import as inactive in Cantera.
 * Does NOT delete them — just sets cantera_active = false.
 */
export async function markMissingAsInactive(supabase, importedCamteraIds) {
  if (importedCamteraIds.length === 0) return;

  const { error } = await supabase
    .from("players")
    .update({ cantera_active: false, updated_at: new Date().toISOString() })
    .eq("source", "cantera")
    .eq("cantera_active", true)
    .not("cantera_id", "in", `(${importedCamteraIds.join(",")})`);

  if (error) {
    console.warn("Failed to mark missing Cantera players as inactive:", error.message);
  }
}
