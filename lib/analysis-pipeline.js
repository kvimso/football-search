// Core analysis pipeline functions — importable from scripts or API routes
// No process.exit(), no dotenv, no console.log

/**
 * Load all clubs with their most recent squad snapshot from Supabase.
 * Parallelized snapshot loading for speed on serverless.
 */
export async function loadClubsWithSnapshots(supabase) {
  const { data: clubs, error: clubsErr } = await supabase
    .from("clubs")
    .select("id, api_football_id, name, league, country, logo_url, budget_tier");

  if (clubsErr) throw new Error(`Failed to load clubs: ${clubsErr.message}`);
  if (!clubs || clubs.length === 0) {
    throw new Error("No clubs found in database. Run fetch-squads first.");
  }

  // Load all snapshots in parallel instead of sequential queries
  const snapshotPromises = clubs.map((club) =>
    supabase
      .from("squad_snapshots")
      .select("id, snapshot_date, squad_data, player_count")
      .eq("club_id", club.id)
      .order("snapshot_date", { ascending: false })
      .limit(1)
  );

  const snapshotResults = await Promise.all(snapshotPromises);

  const clubsWithSquads = [];
  for (let i = 0; i < clubs.length; i++) {
    const club = clubs[i];
    const snapshot = snapshotResults[i].data?.[0];
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
 * Store opportunities — batch soft-delete then batch insert for all clubs at once.
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

/**
 * Batch store: deactivate all old opportunities and insert all new ones in 2 DB calls.
 */
export async function batchStoreOpportunities(supabase, clubResults) {
  // Single call: deactivate all old opportunities for all clubs being updated
  const clubIds = clubResults.map((r) => r.clubDbId);
  await supabase
    .from("opportunities")
    .update({ is_active: false })
    .in("club_id", clubIds)
    .eq("is_active", true);

  // Build all rows for a single insert
  const allRows = [];
  for (const { clubDbId, snapshotId, gaps } of clubResults) {
    for (const gap of gaps) {
      allRows.push({
        club_id: clubDbId,
        snapshot_id: snapshotId,
        position: gap.position,
        urgency: gap.urgency,
        budget_tier: gap.budget_tier,
        reason: gap.reason,
        ideal_profile: gap.ideal_profile || null,
        transfer_window: gap.transfer_window || null,
        is_active: true,
      });
    }
  }

  if (allRows.length === 0) return { count: 0 };

  const { error } = await supabase.from("opportunities").insert(allRows);
  if (error) throw new Error(`Failed to insert opportunities: ${error.message}`);

  return { count: allRows.length };
}
