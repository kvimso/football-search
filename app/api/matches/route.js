import { NextResponse } from "next/server";
import { getSupabaseServerClient, isSupabaseConfigured } from "../../../lib/supabase.js";

export async function GET(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json([]);
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json([]);
  }
  const { searchParams } = new URL(request.url);
  const opportunityId = searchParams.get("opportunity_id");
  const playerId = searchParams.get("player_id");

  let query = supabase
    .from("player_matches")
    .select(`
      id, match_score, match_reasoning, source, is_confirmed, is_dismissed, created_at,
      players!inner(id, name, age, primary_position, photo_url, current_club),
      opportunities!inner(id, position, urgency, budget_tier, reason, ideal_profile,
        clubs!inner(id, name, logo_url, league, country))
    `)
    .eq("is_dismissed", false)
    .order("match_score", { ascending: false });

  if (opportunityId) {
    query = query.eq("opportunity_id", opportunityId);
  }
  if (playerId) {
    query = query.eq("player_id", playerId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 }
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { match_id, action } = body;

  if (!match_id || !action) {
    return NextResponse.json({ error: "match_id and action are required" }, { status: 400 });
  }

  if (action === "confirm") {
    const { data, error } = await supabase
      .from("player_matches")
      .update({ is_confirmed: true })
      .eq("id", match_id)
      .select(`
        id, player_id, match_score,
        players!inner(name),
        opportunities!inner(id)
      `)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Also create a player_tag for confirmed matches
    if (data) {
      await supabase.from("player_tags").upsert({
        opportunity_id: data.opportunities.id,
        player_name: data.players.name,
        player_id: data.player_id,
        notes: `AI match score: ${data.match_score}/100`,
      }, { onConflict: "opportunity_id,player_name" });
    }

    return NextResponse.json(data);
  }

  if (action === "dismiss") {
    const { error } = await supabase
      .from("player_matches")
      .update({ is_dismissed: true })
      .eq("id", match_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "action must be 'confirm' or 'dismiss'" }, { status: 400 });
}
