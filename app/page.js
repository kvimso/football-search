import { getSupabaseServerClient, isSupabaseConfigured } from "../lib/supabase.js";
import { SAMPLE_CLUBS } from "../lib/sample-data.js";
import { getFallbackAnalysis } from "../lib/fallback-analyzer.js";
import Dashboard from "../components/Dashboard.js";

function getFallbackData() {
  const opportunities = SAMPLE_CLUBS.flatMap((club) => {
    const gaps = getFallbackAnalysis(club);
    return gaps.map((gap, i) => ({
      id: `${club.club_id}-${i}`,
      position: gap.position,
      urgency: gap.urgency,
      budget_tier: gap.budget_tier,
      reason: gap.reason,
      ideal_profile: gap.ideal_profile,
      analyzed_at: new Date().toISOString(),
      is_active: true,
      clubs: {
        id: club.club_id,
        name: club.name,
        logo_url: club.logo,
        league: club.league,
        country: club.country,
      },
    }));
  });

  return { opportunities, tags: [], matches: [], players: [], fallbackMode: true };
}

async function getOpportunities() {
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseServerClient();

      const { data: opportunities, error } = await supabase
        .from("opportunities")
        .select(`
          id, position, urgency, budget_tier, reason, ideal_profile,
          transfer_window, analyzed_at, is_active,
          clubs!inner(id, name, logo_url, league, country)
        `)
        .eq("is_active", true)
        .order("urgency", { ascending: false });

      if (error) {
        console.error("Failed to fetch opportunities:", error.message);
        return getFallbackData();
      }

      const { data: tags } = await supabase
        .from("player_tags")
        .select("id, opportunity_id, player_name, player_id, notes, tagged_at");

      const { data: matches } = await supabase
        .from("player_matches")
        .select(`
          id, player_id, opportunity_id, match_score, match_reasoning, source, is_confirmed, is_dismissed,
          players!inner(id, name, age, primary_position, photo_url)
        `)
        .eq("is_dismissed", false)
        .eq("is_confirmed", false)
        .order("match_score", { ascending: false });

      const { data: players } = await supabase
        .from("players")
        .select("id, name, age, primary_position, secondary_position, photo_url")
        .eq("is_active", true)
        .order("name");

      return {
        opportunities: opportunities || [],
        tags: tags || [],
        matches: matches || [],
        players: players || [],
        fallbackMode: false,
      };
    } catch (err) {
      console.error("Supabase connection failed:", err.message);
      return getFallbackData();
    }
  }

  return getFallbackData();
}

export default async function Home() {
  const { opportunities, tags, matches, players, fallbackMode } = await getOpportunities();

  return (
    <Dashboard
      opportunities={opportunities}
      initialTags={tags}
      fallbackMode={fallbackMode}
      initialMatches={matches}
      initialPlayers={players}
    />
  );
}
