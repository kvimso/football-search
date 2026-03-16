import { getSupabaseServerClient, isSupabaseConfigured } from "../../../lib/supabase.js";
import PlayerDetail from "../../../components/PlayerDetail.js";
import { notFound } from "next/navigation";

async function getPlayerData(id) {
  if (!isSupabaseConfigured()) {
    return null; // Detail pages not available in fallback mode
  }

  const supabase = getSupabaseServerClient();

  const { data: player, error } = await supabase
    .from("players")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !player) return null;

  const { data: matches } = await supabase
    .from("player_matches")
    .select(`
      id, match_score, match_reasoning, source, is_confirmed, is_dismissed, created_at,
      opportunities!inner(id, position, urgency, budget_tier, reason, ideal_profile, is_active,
        clubs!inner(id, name, logo_url, league, country))
    `)
    .eq("player_id", id)
    .eq("is_dismissed", false)
    .order("match_score", { ascending: false });

  return { player, matches: matches || [] };
}

export default async function PlayerDetailPage({ params }) {
  const { id } = await params;
  const data = await getPlayerData(id);

  if (!data) {
    notFound();
  }

  return <PlayerDetail player={data.player} matches={data.matches} />;
}
