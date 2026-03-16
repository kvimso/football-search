import { getSupabaseServerClient, isSupabaseConfigured } from "../../lib/supabase.js";
import { SAMPLE_PLAYERS } from "../../lib/sample-players.js";
import PlayerRoster from "../../components/PlayerRoster.js";

async function getPlayers() {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) {
      console.error("Failed to fetch players:", error.message);
      return { players: [], fallbackMode: true };
    }
    return { players: data || [], fallbackMode: false };
  }

  return { players: SAMPLE_PLAYERS, fallbackMode: true };
}

export default async function PlayersPage() {
  const { players, fallbackMode } = await getPlayers();
  return <PlayerRoster initialPlayers={players} fallbackMode={fallbackMode} />;
}
