import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../../lib/supabase.js";
import { loadClubsWithSnapshots } from "../../../lib/analysis-pipeline.js";
import { analyzeBatch } from "../../../lib/ai-analyzer.js";

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const clubs = await loadClubsWithSnapshots(supabase);

    // Test with just 2 clubs to save time
    const testClubs = clubs.slice(0, 2);
    const clubInfo = testClubs.map((c) => ({
      name: c.name,
      league: c.league,
      squadSize: c.squad?.length,
      samplePlayers: c.squad?.slice(0, 3).map((p) => `${p.name} (${p.position})`),
    }));

    const results = await analyzeBatch(testClubs);

    return NextResponse.json({
      clubs_loaded: clubs.length,
      test_clubs: clubInfo,
      results: results.map((r) => ({
        club: r.club_name,
        source: r.source,
        gaps_count: r.gaps?.length,
        gaps: r.gaps,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack?.split("\n").slice(0, 5) });
  }
}
