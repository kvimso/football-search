import { NextResponse } from "next/server";
import { getSupabaseServerClient, isSupabaseConfigured } from "../../../lib/supabase.js";
import { normalizePosition } from "../../../lib/position-normalizer.js";
import { SAMPLE_PLAYERS } from "../../../lib/sample-players.js";

export async function GET(request) {
  if (!isSupabaseConfigured()) {
    // Fallback: return sample players
    const { searchParams } = new URL(request.url);
    const position = searchParams.get("position");
    let players = SAMPLE_PLAYERS;
    if (position) {
      players = players.filter(
        (p) => p.primary_position === position || p.secondary_position === position
      );
    }
    return NextResponse.json(players);
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(SAMPLE_PLAYERS);
  }
  const { searchParams } = new URL(request.url);
  const position = searchParams.get("position");
  const nationality = searchParams.get("nationality");

  let query = supabase
    .from("players")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (position) {
    query = query.or(`primary_position.eq.${position},secondary_position.eq.${position}`);
  }
  if (nationality) {
    query = query.eq("nationality", nationality);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured. Use localStorage for players in demo mode." },
      { status: 503 }
    );
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

  const { name, age, primary_position, secondary_position, nationality, current_club,
    contract_status, contract_until, stats, video_links, scouting_notes, photo_url } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!primary_position?.trim()) {
    return NextResponse.json({ error: "primary_position is required" }, { status: 400 });
  }

  // Normalize positions
  const normalizedPrimary = normalizePosition(primary_position) || primary_position.trim();
  const normalizedSecondary = secondary_position
    ? normalizePosition(secondary_position) || secondary_position.trim()
    : null;

  const { data, error } = await supabase
    .from("players")
    .insert({
      name: name.trim(),
      age: age || null,
      primary_position: normalizedPrimary,
      secondary_position: normalizedSecondary,
      nationality: nationality?.trim() || "Georgia",
      current_club: current_club?.trim() || null,
      contract_status: contract_status || null,
      contract_until: contract_until || null,
      stats: stats || {},
      video_links: video_links || [],
      scouting_notes: scouting_notes?.trim() || null,
      photo_url: photo_url?.trim() || null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
