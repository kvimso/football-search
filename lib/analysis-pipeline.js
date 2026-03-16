// Core analysis pipeline functions — importable from scripts or API routes
// No process.exit(), no dotenv, no console.log

/**
 * Load all clubs with their most recent squad snapshot from Supabase.
 * @param {object} supabase - Supabase client
 * @returns {Array<{ db_id, snapshot_id, club_id, name, league, country, logo, budget_tier, squad }>}
 */
export async function loadClubsWithSnapshots(supabase) {
  const { data: clubs, error: clubsErr } = await supabase
    .from("clubs")
    .select("id, api_football_id, name, league, country, logo_url, budget_tier");

  if (clubsErr) throw new Error(`Failed to load clubs: ${clubsErr.message}`);
  if (!clubs || clubs.length === 0) {
    throw new Error("No clubs found in database. Run fetch-squads first.");
  }

  const clubsWithSquads = [];
  for (const club of clubs) {
    const { data: snapshots } = await supabase
      .from("squad_snapshots")
      .select("id, snapshot_date, squad_data, player_count")
      .eq("club_id", club.id)
      .order("snapshot_date", { ascending: false })
      .limit(1);

    const snapshot = snapshots?.[0];
    if (!snapshot || !snapshot.squad_data || snapshot.player_count === 0) {
      continue;
    }

    clubsWithSquads.push({
      db_id: club.id,
      snapshot_id: snapshot.id,
      club_id: club.api_football_id,
      name: club.name,
      league: club.league,
      country: club.country,
      logo: club.logo_url,
      budget_tier: club.budget_tier,
      squad: snapshot.squad_data,
    });
  }

  return clubsWithSquads;
}

/**
 * Store opportunities with per-club soft-delete then insert.
 * @param {object} supabase - Supabase client
 * @param {string} clubDbId - Club UUID
 * @param {string} snapshotId - Snapshot UUID
 * @param {Array} gaps - Analysis gaps to store
 */
export async function storeOpportunities(supabase, clubDbId, snapshotId, gaps) {
  // Soft-delete old opportunities for this club
  const { error: deleteErr } = await supabase
    .from("opportunities")
    .update({ is_active: false })
    .eq("club_id", clubDbId)
    .eq("is_active", true);

  if (deleteErr) {
    throw new Error(`Failed to deactivate old opportunities: ${deleteErr.message}`);
  }

  // Insert new opportunities
  if (gaps.length === 0) return;

  const rows = gaps.map((gap) => ({
    club_id: clubDbId,
    snapshot_id: snapshotId,
    position: gap.position,
    urgency: gap.urgency,
    budget_tier: gap.budget_tier,
    reason: gap.reason,
    ideal_profile: gap.ideal_profile || null,
    transfer_window: gap.transfer_window || null,
    is_active: true,
  }));

  const { error: insertErr } = await supabase.from("opportunities").insert(rows);
  if (insertErr) {
    throw new Error(`Failed to insert opportunities: ${insertErr.message}`);
  }
}
