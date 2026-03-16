---
title: "Deploy Prep (Build.md Session 5)"
type: feat
status: completed
date: 2026-03-16
---

# Deploy Prep

## Overview

Build.md Session 5 prepares the FFA Scout Board for Vercel deployment. Five tasks: environment variable validation on startup, hardened error handling for production, .gitignore verification, README.md creation, and build verification. SpecFlow analysis surfaced three critical gaps not in the original spec: Vercel function timeout for `/api/analyze`, stale pipeline_runs locking out the refresh button, and missing `GEMINI_API_KEY` from the validation list.

## Problem Statement / Motivation

1. **No startup validation** — Each module independently checks its own env vars at call-time with scattered placeholder-string comparisons. A misconfigured deployment gives no clear feedback — Levan would see sample data with no explanation of what's missing.

2. **Vercel function timeout** — `/api/analyze` runs Gemini batch analysis (30-60 seconds). Vercel hobby tier defaults to 10 seconds. Without `maxDuration`, the function will be killed mid-execution, leaving a `pipeline_runs` row stuck as `"running"` that permanently blocks all future analysis via the 409 concurrent-run guard.

3. **No retry on Claude fallback** — Gemini analyzer retries once on 429/quota errors. The Claude fallback path in `ai-analyzer.js` has zero retry logic — a single transient network error skips straight to heuristic analysis.

4. **Null server client crash** — `isSupabaseConfigured()` checks `anon_key` while `getSupabaseServerClient()` checks `service_role_key`. A split configuration (anon key set, service key missing) passes the guard but returns `null`, causing `TypeError` when API routes call `.from()` on null.

5. **No README** — Required for any deployed project. Build.md spec requires setup instructions.

6. **.gitignore exists but incomplete** — Missing `.vercel/` directory entry.

## Proposed Solution

Eight focused changes across existing files + two new files.

### Step 1 — Environment Variable Validation (`lib/env-check.js`)

**Create `lib/env-check.js`**: A centralized validation module that logs env var status to the server console on first invocation. Checks all 6 active variables (4 from Build.md spec + 2 identified by SpecFlow).

```js
// lib/env-check.js
const CHECKS = [
  { name: "NEXT_PUBLIC_SUPABASE_URL",     required: true,  label: "Supabase URL" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true,  label: "Supabase Anon Key" },
  { name: "SUPABASE_SERVICE_ROLE_KEY",     required: true,  label: "Supabase Service Key" },
  { name: "GEMINI_API_KEY",               required: false, label: "Gemini AI (primary)", fallback: "heuristic analysis" },
  { name: "ANTHROPIC_API_KEY",            required: false, label: "Claude AI (fallback)", fallback: "heuristic analysis" },
  { name: "API_FOOTBALL_KEY",             required: false, label: "API-Football",         fallback: "sample data" },
];

let logged = false;

export function logEnvStatus() {
  if (logged) return;
  logged = true;

  console.log("\n=== FFA Scout Board — Environment ===");
  for (const check of CHECKS) {
    const value = process.env[check.name];
    const isPlaceholder = value && (value.includes("your_") || value.includes("your-") || value.includes("_here"));
    const isSet = value && !isPlaceholder;

    if (isSet) {
      console.log(`  ✓ ${check.label}`);
    } else if (check.required) {
      console.log(`  ✗ ${check.label} — MISSING (required)`);
    } else {
      console.log(`  - ${check.label} — not set → ${check.fallback}`);
    }
  }
  console.log("=====================================\n");
}
```

**Call site — `app/layout.js`**: Import and call `logEnvStatus()` at module level (runs once on cold start in Next.js).

```js
import { logEnvStatus } from "../lib/env-check.js";
logEnvStatus();
```

**Design decisions:**
- Module-level `logged` flag ensures the status table prints exactly once per cold start, not on every request
- Detects placeholder values using the same patterns already scattered through the codebase (`"your_"`, `"_here"`)
- Required vs optional distinction matches Build.md spec + CLAUDE.md's "App works with sample data when no keys are configured"
- `GEMINI_API_KEY` is listed as primary (not mentioned in Build.md but it IS the primary analyzer per CLAUDE.md)
- Does NOT throw on missing required vars — the app's existing fallback chain handles degradation gracefully

### Step 2 — Vercel Function Timeout for `/api/analyze`

**`app/api/analyze/route.js`**: Add `maxDuration` export at the top of the file.

```js
// Allow up to 60 seconds for Gemini batch analysis
export const maxDuration = 60;
```

This is a one-line change that prevents the most critical deployment failure. Vercel hobby tier supports up to 60 seconds with this export. The analysis pipeline typically completes in 30-45 seconds for cached squads.

### Step 3 — Stale Pipeline Run Cleanup

**`app/api/analyze/route.js`**: Before the concurrent-run check, expire any "running" rows older than 30 minutes.

```js
// Expire stale "running" entries (e.g., from crashed/timed-out functions)
await supabase
  .from("pipeline_runs")
  .update({ status: "failed", error_log: [{ fatal: "Timed out after 30 minutes" }] })
  .eq("run_type", "analyze")
  .eq("status", "running")
  .lt("started_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());
```

Insert this between lines 17-28 (after `getSupabaseServerClient()`, before the concurrent-run select). This prevents a single timeout from permanently locking out the refresh button.

### Step 4 — Null-Check for Server Client in API Routes

**All API route files**: Add a null-check after `getSupabaseServerClient()` to catch the split-configuration edge case (anon key set, service key missing).

```js
const supabase = getSupabaseServerClient();
if (!supabase) {
  return NextResponse.json(
    { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
    { status: 503 }
  );
}
```

**Files to update** (5 total):
- `app/api/analyze/route.js` — after line 17
- `app/api/cache-status/route.js` — after `getSupabaseServerClient()` call
- `app/api/matches/route.js` — in GET and POST handlers
- `app/api/players/route.js` — in GET handler (POST already has its own check)
- `app/api/players/[id]/route.js` — in GET/PUT/DELETE handlers

### Step 5 — Claude Retry Logic

**`lib/ai-analyzer.js`**: Wrap the `client.messages.create()` call in a retry-once wrapper for transient errors (network timeout, 429, 5xx).

```js
// In analyzeSquad(), replace the bare client.messages.create() call:
let message;
try {
  message = await client.messages.create({ /* ... */ });
} catch (err) {
  // Retry once on transient errors
  if (err.status === 429 || err.status >= 500 || err.code === "ECONNRESET") {
    console.warn(`Claude API error for ${club.name}, retrying in 5s:`, err.message);
    await new Promise((r) => setTimeout(r, 5000));
    try {
      message = await client.messages.create({ /* ... */ });
    } catch (retryErr) {
      console.error(`Claude retry failed for ${club.name}:`, retryErr.message);
      return getFallbackAnalysis(club);
    }
  } else {
    throw err;
  }
}
```

**Design decisions:**
- Retries once (matches Build.md spec: "retry once, then show error")
- 5-second delay between attempts (matches `data-pipeline.js` retry pattern)
- Only retries on transient errors (429 rate limit, 5xx server error, connection reset)
- Falls through to heuristic on retry failure (existing fallback chain)
- Non-transient errors (400 bad request, 401 auth) propagate up — no point retrying

### Step 6 — .gitignore Verification

**`.gitignore`**: Add `.vercel/` entry for Vercel CLI configuration.

```
# vercel
.vercel/
```

The existing .gitignore already covers `node_modules/`, `.next/`, `.env.local`, `data/`, and debug logs. No other changes needed.

### Step 7 — README.md

**Create `README.md`** at project root with setup instructions for both local development and Vercel deployment.

Content outline:
- Title: "FFA Scout Board — AI-powered transfer opportunity radar"
- What it does (1 paragraph)
- Quick start (local dev): clone, `npm install`, copy `.env.local.example`, `npm run dev`
- Environment variables table (required vs optional, with fallback behavior)
- Data pipeline commands (`fetch-squads`, `run-analysis`, `run-matching`)
- Vercel deployment: push to GitHub, add env vars in Vercel dashboard, deploy
- "Built by Nino for Free Football Agency"

### Step 8 — Package.json Engine + Build Verification

**`package.json`**: Add `engines` field to pin Node.js version.

```json
"engines": {
  "node": ">=18"
}
```

**Build verification**: Run `npm run build` and fix any errors. The build was last verified in Session 4 — this step confirms the new changes (env-check import in layout.js, maxDuration export) don't break the build.

### Step 9 — Update CLAUDE.md

Add `env-check.js` to project structure and update "Hosting" line from "Runs locally for demo. Vercel later." to reflect deploy readiness.

## Technical Considerations

**No new dependencies** — All changes use existing libraries (Next.js, Supabase client). No additional npm packages.

**Vercel function timeout** — 60 seconds is the maximum for hobby tier. If analysis consistently exceeds this (131+ clubs), the full pipeline must be run via CLI scripts (`npm run run-analysis`) and only cached results served via the web UI. This is already the intended flow — the web refresh button is for re-analysis, not first-time fetch.

**Pipeline run cleanup** — The 30-minute TTL is generous (analysis takes 30-60 seconds). If a function is killed at 60 seconds, the cleanup catches it on the next attempt. The `started_at` column is used (not `created_at`) because that's what `pipeline-logger.js` sets.

**Fallback mode** — All changes work identically in both Supabase and fallback/sample-data modes. The env-check logs status but does not block the app from starting.

**Cold start behavior** — `logEnvStatus()` runs once per cold start due to the `logged` module flag. On Vercel, each serverless function has its own module scope, so the status may log once per function. This is acceptable — it's a diagnostic log, not user-facing.

## Acceptance Criteria

### Step 1 — Env Var Validation
- [x] `lib/env-check.js` created with checks for all 6 active env vars
- [x] Detects placeholder values (not just missing vars)
- [x] Logs clear status table to server console on cold start
- [x] Distinguishes required (Supabase) from optional (AI keys, API-Football)
- [x] Called from `app/layout.js` at module level

### Step 2 — Vercel Function Timeout
- [x] `export const maxDuration = 60` added to `app/api/analyze/route.js`

### Step 3 — Stale Pipeline Run Cleanup
- [x] Stale "running" pipeline_runs (>30 min) auto-expire to "failed" before concurrent-run check
- [x] Cleanup query added before the existing `pipeline_runs` select in `/api/analyze`

### Step 4 — Null-Check Server Client
- [x] All 5 API route files check for null after `getSupabaseServerClient()`
- [x] Return 503 with descriptive error message if null
- [x] No regression on existing Supabase guard (`isSupabaseConfigured()`)

### Step 5 — Claude Retry Logic
- [x] `client.messages.create()` retries once on 429/5xx/ECONNRESET
- [x] 5-second delay between attempts
- [x] Falls back to heuristic on retry failure
- [x] Non-transient errors still propagate

### Step 6 — .gitignore
- [x] `.vercel/` entry added
- [x] Existing entries confirmed present (node_modules, .next, .env.local, data/)

### Step 7 — README.md
- [x] Created at project root
- [x] Includes local dev setup instructions
- [x] Includes Vercel deployment instructions
- [x] Includes environment variable table (required vs optional)
- [x] Includes data pipeline commands
- [x] Credits "Built by Nino for Free Football Agency"

### Step 8 — Package.json + Build
- [x] `"engines": { "node": ">=18" }` added to package.json
- [x] `npm run build` succeeds with no new errors

### Step 9 — CLAUDE.md Update
- [x] `env-check.js` added to project structure
- [x] Hosting description updated

## Dependencies & Risks

**Dependencies:**
- Steps 1-7 are independent and can be done in any order
- Step 8 (build) should come after Steps 1-5 (code changes) to verify they don't break the build
- Step 9 (CLAUDE.md) is done last

**Risks:**
- **Low risk overall** — These are hardening changes with no database migrations, no new UI, and no external service calls
- **`maxDuration` and Vercel plan**: If the Vercel plan is hobby tier, 60 seconds is the max. For 131+ clubs, full analysis must be run via CLI. The web refresh button already sends `force: true` which only triggers re-analysis (not squad fetching), so 60 seconds should be sufficient for the analysis step alone
- **Module-level import in layout.js**: `logEnvStatus()` executes at import time. If it somehow throws, it could break page rendering. Mitigate by wrapping the function body in try/catch
- **Stale run cleanup race condition**: Two concurrent requests could both see a stale "running" row, both expire it, and both proceed to start new analysis. Low risk — the `logPipelineRun` insert at line 94 creates a new "running" row, and the next request would see it and return 409

## Sources & References

- Build.md Session 5 spec: `Build.md` lines 224-253
- Session 4 plan (completed): `docs/plans/2026-03-16-feat-dashboard-polish-plan.md`
- Analyze API route: `app/api/analyze/route.js` (concurrent guard lines 28-41, cache check lines 43-73)
- Supabase client: `lib/supabase.js` (`isSupabaseConfigured()` checks anon key at line 30-36, `getSupabaseServerClient()` checks service key at line 20-23)
- Claude analyzer: `lib/ai-analyzer.js` (bare `client.messages.create()` at line 61, no retry)
- Gemini analyzer: `lib/gemini-analyzer.js` (retry pattern at lines 178-199 — reference for Step 5)
- Pipeline logger: `lib/pipeline-logger.js` (non-blocking pipeline_runs insert/update)
- Page data loader: `app/page.js` (fallback chain at lines 32-84)
- Existing .gitignore: `.gitignore` (32 lines, comprehensive except `.vercel/`)
- Package.json: `package.json` (no `engines` field)
