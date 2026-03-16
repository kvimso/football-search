---
title: "Complete Supabase Storage Layer (Build.md Session 2)"
type: feat
status: completed
date: 2026-03-16
---

# Complete Supabase Storage Layer

## Overview

Build.md Session 2 ("Supabase Storage") is ~50% built. The foundation — Supabase client (`lib/supabase.js`), database schema (two migration files with evolved UUID-based design), and package installation — is solid and exceeds the original spec. This plan addresses the remaining gaps: extracting analysis helpers from the CLI script, creating the analysis API route, adding a GET endpoint for tags, and adding a cache-status endpoint.

## Problem Statement / Motivation

1. **No frontend-triggerable analysis** — Analysis only runs via CLI (`scripts/run-analysis.js`). Session 4's "Refresh Data" button needs a POST endpoint to trigger analysis from the dashboard. Without it, Levan must SSH into the server or run scripts locally.

2. **Analysis logic locked in CLI script** — `loadClubsWithSnapshots()` and `storeOpportunities()` are defined inside `scripts/run-analysis.js` alongside `main()` and `process.exit()`. They can't be imported by an API route — the same pattern we fixed for fetch-squads in Session 1.

3. **No client-side tag refresh** — Tags load server-side in `page.js` (Server Component). After tagging a player via POST, the client optimistically updates state, but there's no GET endpoint to re-sync tags if state drifts (e.g., another tab, stale data).

4. **No cache-status endpoint** — Dashboard computes freshness client-side from `analyzed_at` timestamps on loaded opportunities. A dedicated endpoint would let the header show "Last refreshed: 2 days ago" without loading all opportunity data, and is needed for Session 4's cache-awareness features.

## Proposed Solution

Four steps, following Session 1's extraction pattern:

### Step 1 — Extract Analysis Helpers

**Create `lib/analysis-pipeline.js`** with the two Supabase query functions extracted from `scripts/run-analysis.js`:

```js
// lib/analysis-pipeline.js

export async function loadClubsWithSnapshots(supabase) {
  // Loads all clubs with their most recent squad_snapshot
  // Returns: [{ db_id, snapshot_id, club_id, name, league, country, logo, budget_tier, squad }]
  // Throws if no clubs found
}

export async function storeOpportunities(supabase, clubDbId, snapshotId, gaps) {
  // Soft-deletes old active opportunities for the club
  // Inserts new opportunity rows
  // Throws on Supabase errors
}
```

**Then update `scripts/run-analysis.js`** to import from the shared module:
- Remove `loadClubsWithSnapshots()` (lines 18-59) and `storeOpportunities()` (lines 62-93)
- Add `import { loadClubsWithSnapshots, storeOpportunities } from "../lib/analysis-pipeline.js";`
- Script remains a thin CLI wrapper (same pattern as refactored `fetch-squads.js`)

### Step 2 — Create `app/api/analyze/route.js`

**POST endpoint** that triggers analysis from the frontend:

```js
// app/api/analyze/route.js

export async function POST(request) {
  // 1. Check Supabase is configured
  // 2. Parse body for { force: boolean } option
  // 3. Check pipeline_runs for existing "running" analysis (prevent concurrent runs)
  // 4. Check cache freshness: if most recent opportunity.analyzed_at < 168 hours ago
  //    and force !== true, return cached opportunities
  // 5. Otherwise: load clubs → run Gemini batch analysis → store results
  // 6. Log pipeline run (start → complete/failed)
  // 7. Return { status, opportunities_count, source }
}
```

**Design decisions:**
- **Synchronous execution** — Unlike fetch-squads (13+ minutes, rate-limited), Gemini analysis completes in under 60s (131 clubs / 25 per batch = 6 Gemini calls). Fits within Vercel's timeout.
- **Concurrent run prevention** — Check `pipeline_runs` for `status: "running"` + `run_type: "analyze"` before starting. Same guard as `scripts/run-analysis.js` line 113-124.
- **Cache check** — Query `MAX(analyzed_at)` from `opportunities WHERE is_active = true`. If within 168 hours (7 days) and `force !== true`, return early with cached count.
- **No auth required yet** — Single-user app. Session 5 can add auth if needed.

### Step 3 — Add GET to `app/api/tags/route.js`

```js
// Addition to existing app/api/tags/route.js

export async function GET() {
  // 1. Check Supabase is configured
  // 2. Select all tags: id, opportunity_id, player_name, player_id, notes, tagged_at
  // 3. Return JSON array
}
```

Simple read query — mirrors the inline query in `app/page.js:51-52`. No pagination needed (tag count is bounded by opportunities × players, typically < 100 for a single agent).

### Step 4 — Create `app/api/cache-status/route.js`

```js
// app/api/cache-status/route.js

export async function GET() {
  // 1. Check Supabase is configured
  // 2. Query: MAX(snapshot_date) from squad_snapshots → squads_cached_at
  // 3. Query: MAX(analyzed_at) from opportunities WHERE is_active = true → analysis_cached_at
  // 4. Return { squads_cached_at, analysis_cached_at, squads_age_hours, analysis_age_hours }
}
```

Two simple `MAX()` queries. Returns null for timestamps if no data exists yet (first-run scenario).

### Step 5 — Update CLAUDE.md

Add `analysis-pipeline.js` to project structure. Document that analysis can now be triggered via API route.

## Technical Considerations

**Analysis execution time:**
- Gemini 2.5 Flash processes 25 clubs/batch with ~3-5s response time
- 131 clubs = 6 batches = ~30-40s total (+ 2s inter-batch delay)
- Well within Vercel's 60s hobby-tier timeout and 300s pro timeout
- Heuristic fallback (no Gemini key) completes in <1s

**Cache freshness logic:**
- The 168-hour (7-day) window matches Build.md spec
- Dashboard's existing `isStale` check uses 9 days — the API uses 7 days for proactive refresh before visual staleness
- `force=true` bypasses the cache check entirely

**Concurrency guard:**
- `pipeline_runs` table already tracks running pipelines (added in Session 1)
- The analysis route checks for `status: "running"` before starting
- If a pipeline crashes without updating its status, manual DB fix is required (same limitation as CLI scripts — acceptable for single-user MVP)

**lib/cache.js from Build.md spec:**
- Intentionally **not created** as a separate module
- The Build.md spec wanted `saveSquadsToCache`, `loadSquadsFromCache`, etc. as a centralized abstraction
- The codebase evolved with domain-specific modules instead: `data-pipeline.js` handles fetch operations, `analysis-pipeline.js` handles analysis operations
- This is a better separation of concerns than a generic "cache" module that would just wrap Supabase queries

## Acceptance Criteria

### Step 1 — Analysis Helpers
- [x] `lib/analysis-pipeline.js` exports `loadClubsWithSnapshots()` and `storeOpportunities()`
- [x] `scripts/run-analysis.js` imports from `lib/analysis-pipeline.js` instead of inline copies
- [ ] `npm run run-analysis -- --sample` still works (no regression)

### Step 2 — Analyze API Route
- [x] `POST /api/analyze` returns cached analysis if < 168 hours old
- [x] `POST /api/analyze` with `{ "force": true }` runs fresh analysis regardless of cache age
- [x] Concurrent run prevention: returns 409 if analysis already running
- [x] Returns `{ status, opportunities_count, source }` on success
- [x] Logs pipeline run to `pipeline_runs` table
- [x] Falls back to heuristic analysis if Gemini key not configured

### Step 3 — Tags GET
- [x] `GET /api/tags` returns all tags as JSON array
- [x] Response shape matches existing inline query: `{ id, opportunity_id, player_name, player_id, notes, tagged_at }`
- [x] Returns 503 if Supabase not configured

### Step 4 — Cache Status
- [x] `GET /api/cache-status` returns `{ squads_cached_at, analysis_cached_at }`
- [x] Returns null timestamps when no data exists
- [x] Returns 503 if Supabase not configured

### Step 5 — Documentation
- [x] CLAUDE.md project structure updated with `analysis-pipeline.js`
- [x] CLAUDE.md updated with analyze API route documentation

## Dependencies & Risks

**Dependencies:**
- Step 1 (extraction) must complete before Step 2 (API route imports the helpers)
- Steps 3 and 4 are independent — can be done in parallel with Steps 1-2
- Step 5 is done last

**Risks:**
- **Gemini rate limit during testing:** Each analysis run costs 6 Gemini API calls. Use `--sample` for testing (heuristic fallback, no Gemini calls).
- **Vercel timeout:** If Gemini responds slowly, a 131-club analysis could exceed 60s on Vercel hobby tier. Mitigation: the route falls back to heuristic if Gemini fails, so worst case is fast heuristic analysis.
- **Stale pipeline_runs:** If a previous run crashed without completing, the concurrent-run check blocks new runs. Single-user MVP — manual DB fix is acceptable. Document this.

## Sources & References

- Build.md Session 2 spec: `/mnt/c/Users/kvims/OneDrive/Desktop/ffa-scout-board/Build.md` lines 75-143
- Session 1 plan (extraction pattern): `docs/plans/2026-03-16-feat-real-data-pipeline-completion-plan.md`
- Analysis script: `scripts/run-analysis.js` (functions to extract at lines 18-93)
- Tags route: `app/api/tags/route.js` (POST + DELETE exist, GET missing)
- Gemini analyzer: `lib/gemini-analyzer.js` (batch analysis, 25 clubs/batch)
- Dashboard data loading: `app/page.js:31-85` (Server Component inline queries)
- Dashboard freshness check: `components/Dashboard.js:163-173`
