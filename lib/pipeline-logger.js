// Shared pipeline run logging for all scripts
// Logs to Supabase pipeline_runs table

export async function logPipelineRun(supabase, { runType, status, leaguesProcessed, clubsProcessed, clubsFailed, errorLog }) {
  if (!supabase) return null;
  try {
    const row = {
      run_type: runType,
      status,
      clubs_processed: clubsProcessed || 0,
      clubs_failed: clubsFailed || 0,
      error_log: errorLog || null,
      completed_at: status !== "running" ? new Date().toISOString() : null,
    };
    if (leaguesProcessed) row.leagues_processed = leaguesProcessed;

    const { data, error } = await supabase
      .from("pipeline_runs")
      .insert(row)
      .select("id")
      .single();

    if (error) console.error("Failed to log pipeline run:", error.message);
    return data?.id || null;
  } catch (err) {
    console.error("Failed to log pipeline run:", err.message);
    return null;
  }
}

export async function updatePipelineRun(supabase, runId, updates) {
  if (!supabase || !runId) return;
  try {
    await supabase.from("pipeline_runs").update({
      ...updates,
      completed_at: updates.status !== "running" ? new Date().toISOString() : undefined,
    }).eq("id", runId);
  } catch (err) {
    console.error("Failed to update pipeline run:", err.message);
  }
}
