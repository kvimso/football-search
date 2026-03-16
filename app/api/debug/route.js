import { NextResponse } from "next/server";
import { getSupabaseServerClient, isSupabaseConfigured } from "../../../lib/supabase.js";

export async function GET() {
  const configured = isSupabaseConfigured();
  if (!configured) {
    return NextResponse.json({ error: "Supabase not configured", configured });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "No server client" });
  }

  const { data: opportunities, error } = await supabase
    .from("opportunities")
    .select(`id, position, urgency, budget_tier, reason, is_active, clubs!inner(id, name, league, country)`)
    .eq("is_active", true)
    .order("urgency", { ascending: false })
    .limit(5);

  return NextResponse.json({
    configured,
    error: error?.message || null,
    count: opportunities?.length || 0,
    sample: opportunities?.slice(0, 3),
  });
}
