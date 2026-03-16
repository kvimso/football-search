---
title: "Complete Real Data Pipeline (Build.md Session 1)"
type: feat
status: completed
date: 2026-03-16
---

# Complete Real Data Pipeline

## Overview

Build.md Session 1 ("Real Data Pipeline") is ~80% already built. The core API-Football client (`lib/api-football.js`), squad fetching script (`scripts/fetch-squads.js`), and team cache (`data/league-teams.json`) all exist. This plan addresses the remaining gaps: extracting duplicated pipeline logging, using the team cache to save API requests, adding injury data fetching, extracting reusable pipeline functions, and optionally adding a frontend trigger route.

## Problem Statement / Motivation

1. **Wasted API budget** — `fetch-squads.js` calls `getTeamsByLeague()` for every league on every run, burning 7 requests even though `data/league-teams.json` already has all 131 teams cached. On a 100 req/day free tier, this matters.
2. **No injury data** — The AI analysis prompt scores injuries as urgency=3 (CRITICAL), but live squad data from `/players/squads` has no injury fields. Without injuries, live analysis misses the highest-value opportunities.
3. **Copy-pasted pipeline logging** — `logPipelineRun()` and `updatePipelineRun()` are duplicated across 3 scripts (fetch-squads, run-analysis, run-matching). Bug risk when only one copy gets updated.
4. **Pipeline logic locked in scripts** — `fetch-squads.js` calls `process.exit()` and has `main()` at module scope, making it impossible to import from an API route or test in isolation.
5. **No frontend refresh trigger** — Levan must run CLI scripts to refresh data. A dashboard "Refresh" button would improve UX.

## Proposed Solution

Six steps, ordered by dependency and value:

### Phase 1: Quick Wins (Steps 1-2)

#### Step 1 — Extract Pipeline Logger

**Create `lib/pipeline-logger.js`** with `logPipelineRun()` and `updatePipelineRun()` extracted from the three scripts.

```js
// lib/pipeline-logger.js
export async function logPipelineRun(supabase, { runType, status, metadata }) { ... }
export async function updatePipelineRun(supabase, runId, { status, metadata }) { ... }
```

**Then update these files to import from the shared module:**
- `scripts/fetch-squads.js` — remove lines 54-84, import from `lib/pipeline-logger.js`
- `scripts/run-analysis.js` — remove lines 16-44, import from `lib/pipeline-logger.js`
- `scripts/run-matching.js` — remove lines 22-50, import from `lib/pipeline-logger.js`

#### Step 2 — Use Team Cache in fetch-squads.js

**Create `lib/team-cache.js`** (or add to `lib/api-football.js`):

```js
// lib/team-cache.js
export function loadTeamCache(leagueId, { maxAgeDays = 30, expectedSeason } = {}) { ... }
export function saveTeamCache(leagues) { ... }
```

Logic:
1. Read `data/league-teams.json`
2. Check `fetched_at` is within `maxAgeDays`
3. Check `season` matches `getCurrentSeason()`
4. If valid, return teams for the requested league (or all leagues)
5. If stale/missing/wrong season, return `null` → caller falls back to live API call

**Wire into `fetch-squads.js`:** Before calling `getTeamsByLeague()`, check the cache. Saves 7 API requests per full run (42 seconds of rate-limit delay).

### Phase 2: Injury Data (Step 3)

#### Step 3 — Add `getInjuries()` to api-football.js

**Add to `lib/api-football.js`:**

```js
export async function getInjuries(teamId, season) {
  // GET /injuries?team={teamId}&season={season}
  // Returns array of { player: { id, name }, type, reason, date }
  // Maps to: { player_id, player_name, injury_type, return_date }
}
```

**Preserve player API-Football ID in squad transform:**

Currently `transformPlayer()` (line 101-119) discards the player's API-Football `id`. Add it:

```js
// Before: { name, age, position, sub_position: null, number, photo }
// After:  { api_football_id, name, age, position, sub_position: null, number, photo }
```

This enables merging injury data back onto the correct player by ID.

**Add `--with-injuries` flag to `fetch-squads.js`:**

```bash
npm run fetch-squads -- --with-injuries              # Fetch injuries for all teams
npm run fetch-squads -- --with-injuries --league 144  # Injuries for Belgian league only
```

When enabled:
1. After fetching a squad, call `getInjuries(teamId, season)`
2. Match injuries to squad players by `api_football_id`
3. Set `injured: true`, `injury_type`, `return_date` on matched players
4. Store enriched squad in `squad_snapshots.squad_data`

**API budget impact:** +1 request per team. Full run with injuries: 131 (squads) + 131 (injuries) = 262 requests = 3 days on free tier. Without injuries (default): 131 requests = 2 days.

**Do NOT enable by default.** The flag keeps it opt-in so the daily budget isn't unexpectedly doubled.

### Phase 3: Pipeline Extraction (Step 4)

#### Step 4 — Extract Pipeline Library

**Create `lib/data-pipeline.js`** with the core pipeline functions extracted from `fetch-squads.js`:

```js
// lib/data-pipeline.js

export async function fetchTeamsForLeague(leagueId, season, { useCache = true } = {}) {
  // Check team cache first (Step 2), fall back to API
  // Returns: { teams: [...], fromCache: boolean }
}

export async function fetchSquadForTeam(teamId, { withInjuries = false, season } = {}) {
  // Calls getSquad(), optionally getInjuries() and merges
  // Returns: { squad: [...], requestsUsed: number }
}

export async function upsertClubAndSnapshot(supabase, { club, squad, snapshotDate }) {
  // Upserts club row, upserts squad_snapshot
  // Returns: { clubId, snapshotId }
}

export async function runFetchPipeline(supabase, {
  leagues,           // array of { id, name, country }
  season,
  withInjuries,
  onProgress,        // callback: ({ league, team, step, total }) => void
  checkpoint,        // optional resume checkpoint
  onCheckpoint,      // callback to save checkpoint
}) {
  // Orchestrates the full fetch pipeline
  // Does NOT call process.exit() — returns { status, clubsProcessed, errors }
}
```

**Refactor `scripts/fetch-squads.js`** to be a thin CLI wrapper:

```js
#!/usr/bin/env node
import { config } from "dotenv"; config({ path: ".env.local" });
import { runFetchPipeline } from "../lib/data-pipeline.js";
// Parse CLI args, load/save checkpoint file, call runFetchPipeline(), process.exit()
```

Key constraints:
- `lib/data-pipeline.js` must NOT import `dotenv` or call `process.exit()`
- Progress reporting via callback, not `console.log`
- Checkpoint save/load stays in the script (filesystem concern)
- The library returns results; the script decides what to log

### Phase 4: Frontend Trigger (Step 5) — Optional

#### Step 5 — Create `app/api/fetch-data/route.js`

> **Only implement if needed for the demo.** CLI scripts work fine for now.

**Architecture: fire-and-forget with polling.**

Since the pipeline takes 13+ minutes (131 teams x 6s rate limit), it cannot run synchronously in a Next.js API route. Instead:

```
POST /api/fetch-data
  → Checks no pipeline is already running (pipeline_runs table)
  → Inserts a pipeline_runs row with status: "running"
  → Spawns the pipeline in a detached async context
  → Returns { runId, status: "started" }

GET /api/fetch-data?runId=xxx
  → Reads pipeline_runs row
  → Returns { status, clubsProcessed, clubsFailed, errors }
```

**Guard rails:**
- Check `pipeline_runs` for existing `status: "running"` before starting
- Simple auth: require `x-api-secret` header matching an env var (prevents accidental API quota drain)
- Rate limit: reject if last completed run was < 1 hour ago

**Frontend integration (Dashboard.js):**
- "Refresh Data" button → POST → show spinner → poll GET every 10 seconds → update on completion
- Show "Partially complete (X/131 teams) — resume tomorrow" if rate limited

### Phase 5: Documentation (Step 6)

#### Step 6 — Document Known Limitations

Update CLAUDE.md with:
- Sub-position limitation: `/players/squads` returns only broad positions (Goalkeeper/Defender/Midfielder/Attacker). Gemini analysis handles this acceptably via its knowledge of players. Heuristic fallback degrades.
- Injury data is opt-in (`--with-injuries`) due to API cost doubling.
- Team cache invalidates on season change or after 30 days.

## Technical Considerations

**API Budget Math (100 req/day free tier):**

| Scenario | Team list | Squads | Injuries | Total | Days needed |
|----------|-----------|--------|----------|-------|-------------|
| Current (no cache) | 7 | 131 | 0 | 138 | 2 |
| With cache | 0 | 131 | 0 | 131 | 2 |
| With cache + injuries | 0 | 131 | 131 | 262 | 3 |
| Single league (e.g. Belgium, 17 teams) | 0-1 | 17 | 0 | 17-18 | 1 |

**Bug fix (fetch-squads.js line ~236):**
The retry condition `err.message.includes("5")` matches any error containing the digit "5" (e.g., "95 requests"). Should be `/\b5\d{2}\b/` or explicit `500`/`502`/`503` checks.

**Architecture constraint:**
`fetch-squads.js` line 282 calls `main()` at module scope, causing immediate execution on import. This is why pipeline extraction (Step 4) is required before the API route (Step 5).

## Acceptance Criteria

### Step 1 — Pipeline Logger
- [x] `lib/pipeline-logger.js` exports `logPipelineRun()` and `updatePipelineRun()`
- [x] All 3 scripts import from `lib/pipeline-logger.js` instead of inline copies
- [x] `npm run fetch-squads -- --resume` still works (no regression)
- [x] `npm run run-analysis -- --sample` still works

### Step 2 — Team Cache
- [x] `lib/team-cache.js` reads `data/league-teams.json` and validates freshness
- [x] `fetch-squads.js` checks cache before calling `getTeamsByLeague()`
- [x] Cache miss (stale/missing/wrong season) falls back to live API call
- [x] Running `npm run fetch-squads -- --league 144` uses cached team list (0 team-list API calls)

### Step 3 — Injury Data
- [x] `getInjuries(teamId, season)` added to `lib/api-football.js`
- [x] Squad transform preserves `api_football_id` on each player
- [x] `--with-injuries` flag on fetch-squads merges injury data into squad snapshots
- [x] Without the flag, behavior is identical to current (no extra API calls)

### Step 4 — Pipeline Extraction
- [x] `lib/data-pipeline.js` exports `runFetchPipeline()` and helper functions
- [x] `scripts/fetch-squads.js` is a thin wrapper calling the library
- [x] Library functions do not call `process.exit()` or `console.log` directly
- [x] All existing CLI flags (`--resume`, `--league`, `--with-injuries`) still work

### Step 5 — API Route (Optional)
- [ ] `POST /api/fetch-data` starts pipeline and returns run ID — DEFERRED (CLI scripts sufficient for now)
- [ ] `GET /api/fetch-data?runId=xxx` returns pipeline status — DEFERRED
- [ ] Concurrent run prevention (rejects if already running) — DEFERRED
- [ ] Auth guard via shared secret header — DEFERRED

### Step 6 — Documentation
- [x] CLAUDE.md updated with sub-position limitation note
- [x] CLAUDE.md updated with injury data opt-in note

## Dependencies & Risks

**Dependencies:**
- Step 1 (logger) is independent — can be done first
- Step 2 (cache) is independent — can be done in parallel with Step 1
- Step 3 (injuries) depends on Step 2 (uses cache to avoid wasting budget on team lists)
- Step 4 (extraction) depends on Steps 1-3 (extracts the final version of the pipeline)
- Step 5 (API route) depends on Step 4 (imports from the library)

**Risks:**
- **API rate limit during testing:** Each test run of fetch-squads burns real API requests. Use `--league 144` (17 teams) for testing, not full runs.
- **Injury endpoint response format:** The API-Football `/injuries` endpoint response structure needs verification. The docs show it returns player objects, but the exact field mapping needs a test call.
- **Checkpoint compatibility:** Refactoring fetch-squads.js could break existing checkpoint files. Clear `data/fetch-progress.json` before testing.

## Sources & References

- Build.md Session 1 spec: `/mnt/c/Users/kvims/OneDrive/Desktop/ffa-scout-board/Build.md` lines 33-71
- Existing API client: `lib/api-football.js` (rate limiting, auth, team/squad fetching)
- Existing pipeline: `scripts/fetch-squads.js` (checkpoint/resume, Supabase upserts)
- Team cache: `data/league-teams.json` (131 teams, 7 leagues, fetched 2026-03-16)
- Pipeline logging duplication: `scripts/fetch-squads.js:54-84`, `scripts/run-analysis.js:16-44`, `scripts/run-matching.js:22-50`
