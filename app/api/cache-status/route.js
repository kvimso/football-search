import { NextResponse } from "next/server";
import { getSupabaseServerClient, isSupabaseConfigured } from "../../../lib/supabase.js";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured" },
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

  // Get most recent squad snapshot date
  const { data: squadData } = await supabase
    .from("squad_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1);

  // Get most recent analysis timestamp
  const { data: analysisData } = await supabase
    .from("opportunities")
    .select("analyzed_at")
    .eq("is_active", true)
    .order("analyzed_at", { ascending: false })
    .limit(1);

  const squadsCachedAt = squadData?.[0]?.snapshot_date || null;
  const analysisCachedAt = analysisData?.[0]?.analyzed_at || null;

  const now = Date.now();
  const squadsAgeHours = squadsCachedAt
    ? Math.round((now - new Date(squadsCachedAt).getTime()) / (1000 * 60 * 60))
    : null;
  const analysisAgeHours = analysisCachedAt
    ? Math.round((now - new Date(analysisCachedAt).getTime()) / (1000 * 60 * 60))
    : null;

  return NextResponse.json({
    squads_cached_at: squadsCachedAt,
    analysis_cached_at: analysisCachedAt,
    squads_age_hours: squadsAgeHours,
    analysis_age_hours: analysisAgeHours,
  });
}
