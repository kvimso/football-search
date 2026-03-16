---
title: "Dashboard Polish (Build.md Session 4)"
type: feat
status: completed
date: 2026-03-16
---

# Dashboard Polish

## Overview

Build.md Session 4 ("Dashboard Polish") is ~60% built. The foundational elements — sort by urgency, club logos with fallback, stagger animations, stats panel, responsive grid, filter bar — all work. This plan addresses the remaining gaps: Refresh Data button with progress UI, mode badges, relative time display, welcome screen for first visit, skeleton loaders during refresh, error banner, and footer.

## Problem Statement / Motivation

1. **No way to refresh data from the dashboard** — Levan has to run CLI scripts to update analysis. The `/api/analyze` endpoint exists (Session 2) but has no frontend trigger. Levan needs a "Refresh Data" button.

2. **No feedback during refresh** — When Levan triggers analysis, there's no progress indication. The page looks frozen for 30-60 seconds. He needs visual feedback ("Analyzing...") and a disabled button to prevent double-clicks.

3. **No mode awareness** — Levan can't tell at a glance if he's looking at live Supabase data or sample demo data. A small badge would make this obvious.

4. **Absolute date display** — Header shows "Last analyzed: March 14, 2026" but "2 days ago" is more scannable for daily use. Levan cares about freshness, not the exact date.

5. **No welcome screen** — First visit with Supabase configured but no data shows a generic "No transfer opportunities available" message with a CLI command hint. Should show a proper welcome with a "Run First Analysis" button.

6. **No loading state during refresh** — After clicking refresh, the existing cards stay visible with no indication that new data is incoming. Skeleton loaders would signal that fresh data is loading.

7. **No error handling for refresh** — If the analysis API fails, there's no user-facing error. Errors only log to console. A red banner with "Try Again" would let Levan recover.

8. **No footer** — Page ends abruptly. A simple footer with version and branding completes the professional look.

## Proposed Solution

Seven focused changes. Steps are ordered by dependency; most can be done independently after Step 1.

### Step 1 — Refresh Data Button + Progress UI

**`components/Dashboard.js`**: Add refresh state management and a "Refresh Data" button in the header.

**New state:**
```js
const [refreshState, setRefreshState] = useState("idle"); // "idle" | "analyzing" | "error"
const [refreshError, setRefreshError] = useState(null);
```

**New handler:**
```js
const handleRefresh = useCallback(async () => {
  setRefreshState("analyzing");
  setRefreshError(null);
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analysis failed");
    // Re-run server component to get fresh data
    router.refresh();
    setRefreshState("idle");
  } catch (err) {
    setRefreshError(err.message);
    setRefreshState("error");
  }
}, [router]);
```

**New import:**
```js
import { useRouter } from "next/navigation";
```

**New variable in component:**
```js
const router = useRouter();
```

**Header UI addition** (next to the "Last analyzed" section):
```jsx
{!fallbackMode && (
  <button
    onClick={handleRefresh}
    disabled={refreshState === "analyzing"}
    className={`px-3 py-1.5 text-sm rounded transition-colors ${
      refreshState === "analyzing"
        ? "bg-scout-accent/10 text-gray-400 cursor-wait"
        : "bg-scout-accent/20 text-scout-accent hover:bg-scout-accent/30"
    }`}
  >
    {refreshState === "analyzing" ? "Analyzing..." : "Refresh Data"}
  </button>
)}
```

**Design decisions:**
- **Analysis only, not full pipeline** — The spec says "triggers full pipeline (fetch + analyze)" but `fetch-squads` takes 13+ minutes (131 teams, API rate limit 100 req/day). No `/api/fetch-squads` endpoint exists. The `/api/analyze` endpoint completes in 30-60s and is the realistic scope. Squad data refresh stays CLI-only.
- **`force: true`** — Bypasses the 168-hour cache check so the button always runs fresh analysis.
- **`router.refresh()`** — Next.js App Router pattern. Re-runs `page.js` Server Component to fetch updated opportunities from Supabase. Client state (filters, tags, expanded cards) is preserved because `router.refresh()` only re-renders the server tree.
- **Button hidden in fallback mode** — Analysis requires Supabase + Gemini/heuristic. Sample data doesn't benefit from refresh.
- **409 handling** — The analyze endpoint returns 409 if analysis is already running. The error message will show in the error banner (Step 5).
- **No multi-phase progress** — The spec wanted "Fetching squads..." then "Analyzing..." but since we only trigger analysis (not fetch), a single "Analyzing..." state is sufficient. Adding fetch to the button would require a new API endpoint and 13+ minute timeout handling — out of scope for MVP.

### Step 2 — Mode Badges

**`components/Dashboard.js`**: Add a badge row below the header title showing data source.

```jsx
<div className="flex gap-2 mt-2">
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
    fallbackMode
      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
      : "bg-green-500/20 text-green-400 border border-green-500/30"
  }`}>
    {fallbackMode ? "Sample Data" : "Live Data"}
  </span>
</div>
```

**Design decisions:**
- **"Sample Data" / "Live Data" only** — The spec also wanted "AI-Powered" / "Heuristic Mode" but this information isn't available on the frontend. The analysis source (gemini/heuristic) is not stored per-opportunity or exposed via any existing endpoint. Adding it would require schema changes or a new endpoint — overkill for a badge.
- **Replaces the existing "Demo mode — using sample data" text** — The new badge is more scannable and uses the same badge styling pattern as urgency/budget badges.
- **Uses existing badge patterns** — Green border for live (matches budget-high), amber for sample (matches urgency-medium).

### Step 3 — Relative Time Display

**`components/Dashboard.js`**: Change "Last analyzed: March 14, 2026" to "Last analyzed: 2 days ago".

Replace the `lastAnalyzed.toLocaleDateString(...)` with a relative time helper:

```js
function formatRelativeTime(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
```

**Design decisions:**
- **No date-fns** — Simple arithmetic matches existing patterns (the `isStale` check already does this).
- **Falls back to absolute date for >30 days** — Relative time loses meaning for old data.
- **Show absolute date on hover** — Add `title={lastAnalyzed.toLocaleDateString(...)}` to the span for full date on hover.

### Step 4 — Welcome Screen (First Visit)

**`components/EmptyState.js`**: Enhance the `"no-data"` state to differentiate between first visit (Supabase mode) and fallback mode.

Add a new state `"welcome"`:
```js
"welcome": {
  title: "Welcome to FFA Scout Board",
  description: "Your AI-powered transfer opportunity radar is ready. Run your first analysis to populate the dashboard.",
},
```

**`components/Dashboard.js`**: Pass a new `onRefresh` prop to EmptyState when showing the welcome state.

```js
type={
  opportunities.length === 0
    ? (fallbackMode ? "no-data" : "welcome")
    : activeTab === "pipeline" && tags.length === 0
    ? "no-tags"
    : "no-matches"
}
onRefresh={!fallbackMode && opportunities.length === 0 ? handleRefresh : null}
refreshState={refreshState}
```

**`components/EmptyState.js`**: Accept `onRefresh` and `refreshState` props. When `onRefresh` is provided, show a "Run First Analysis" button:

```jsx
{onRefresh && (
  <button
    onClick={onRefresh}
    disabled={refreshState === "analyzing"}
    className="mt-4 px-4 py-2 text-sm bg-scout-accent text-scout-bg rounded font-medium hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-wait"
  >
    {refreshState === "analyzing" ? "Analyzing..." : "Run First Analysis"}
  </button>
)}
```

**Design decisions:**
- **Separate from `"no-data"`** — The `"no-data"` state still exists for fallback mode (shows CLI hint). The `"welcome"` state is specifically for Supabase-configured but empty databases.
- **Reuses `handleRefresh` from Step 1** — Same handler, same error handling.
- **Button uses solid green** — More prominent CTA than the outline-style "Clear all filters" button, since this is the primary action for first-time users.

### Step 5 — Error Banner

**`components/Dashboard.js`**: Add a dismissible error banner below the header.

```jsx
{refreshError && (
  <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between">
    <div className="flex items-center gap-2">
      <span className="text-red-400 text-sm">{refreshError}</span>
    </div>
    <div className="flex items-center gap-2">
      <button
        onClick={handleRefresh}
        className="text-sm text-red-400 hover:text-red-300 transition-colors"
      >
        Try Again
      </button>
      <button
        onClick={() => { setRefreshError(null); setRefreshState("idle"); }}
        className="text-gray-500 hover:text-gray-400 transition-colors"
      >
        &times;
      </button>
    </div>
  </div>
)}
```

**Design decisions:**
- **Position between header and tab bar** — Prominent but not blocking the page.
- **Dismissible** — The &times; button clears the error and resets to idle.
- **"Try Again" button** — Re-triggers the same `handleRefresh` flow.
- **Red theme** — Matches existing badge patterns (`bg-red-500/20` etc.) but stronger for errors.

### Step 6 — Skeleton Loader During Refresh

**`components/Dashboard.js`**: When `refreshState === "analyzing"`, overlay the grid with skeleton cards.

```jsx
{refreshState === "analyzing" && (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
    {Array.from({ length: 6 }).map((_, i) => (
      <div
        key={i}
        className="bg-scout-card border border-scout-border rounded-lg p-5 animate-pulse"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-scout-border" />
          <div className="flex-1">
            <div className="h-4 bg-scout-border rounded w-3/4 mb-2" />
            <div className="h-3 bg-scout-border rounded w-1/2" />
          </div>
        </div>
        <div className="h-4 bg-scout-border rounded w-1/3 mb-3" />
        <div className="flex gap-2 mb-3">
          <div className="h-5 bg-scout-border rounded w-16" />
          <div className="h-5 bg-scout-border rounded w-20" />
        </div>
        <div className="h-3 bg-scout-border rounded w-full mb-2" />
        <div className="h-3 bg-scout-border rounded w-2/3" />
      </div>
    ))}
  </div>
)}
```

**Design decisions:**
- **Inline skeleton, not a separate component** — It's 20 lines of JSX used in one place. A `SkeletonCard.js` component would be over-engineering for a single use site.
- **6 skeleton cards** — Fills the 3-column grid visually (2 rows).
- **`animate-pulse`** — Tailwind's built-in pulse animation. No custom CSS needed.
- **Shown above real cards** — The skeleton appears while the real grid stays below, giving a "loading overlay" feel. Once `router.refresh()` completes and refreshState resets to "idle", the skeletons disappear and updated cards show.

### Step 7 — Footer

**`app/layout.js`**: Add a simple footer below `{children}`.

```jsx
<footer className="border-t border-scout-border mt-12 py-6 text-center text-sm text-gray-500">
  FFA Scout Board v0.1 — Built for Free Football Agency
</footer>
```

**Design decisions:**
- **In `layout.js`, not a separate component** — Two lines of JSX don't warrant a new file.
- **`mt-12`** — Breathing room between content and footer.
- **Matches existing border pattern** — Uses `border-scout-border` consistent with the app.

### Step 8 — Update CLAUDE.md

No new files to add (skeleton is inline, footer is in layout.js). No structural changes.

## Technical Considerations

**`router.refresh()` behavior** — Next.js App Router's `router.refresh()` re-runs the Server Component (`page.js`) and reconciles the new tree with the existing client tree. Client state (useState values like filters, tags, expanded cards) is preserved. This is the documented pattern for refreshing server-fetched data without a full page reload.

**Concurrent refresh prevention** — The `/api/analyze` endpoint already returns 409 if an analysis is `"running"` in `pipeline_runs`. The error will display in the banner via Step 5. The button's disabled state during "analyzing" also prevents client-side double-clicks.

**Fallback mode** — All new features degrade gracefully:
- Refresh button: hidden when `fallbackMode === true`
- Mode badge: shows "Sample Data" in fallback mode
- Welcome screen: shows CLI hint in fallback mode, "Run First Analysis" button in Supabase mode
- Skeleton loader: only appears during refresh (never triggers in fallback mode)
- Error banner: only appears on API failure (never triggers in fallback mode)
- Footer: always visible

**No new API endpoints** — All changes use existing `POST /api/analyze` and `router.refresh()`. No new Supabase queries.

**No new dependencies** — Uses Tailwind's built-in `animate-pulse`, Next.js's `useRouter`, and standard `fetch()`.

## Acceptance Criteria

### Step 1 — Refresh Data Button
- [x] "Refresh Data" button visible in header (Supabase mode only)
- [x] Button triggers POST /api/analyze with force=true
- [x] Button disabled + shows "Analyzing..." during refresh
- [x] After success, page data updates via router.refresh()
- [x] Button hidden in fallback/demo mode

### Step 2 — Mode Badges
- [x] "Live Data" badge shown when Supabase is configured
- [x] "Sample Data" badge shown in fallback mode
- [x] Existing "Demo mode" text replaced by badge
- [x] Badge uses existing design pattern (colored background + border)

### Step 3 — Relative Time
- [x] "Last analyzed" shows relative time ("2 days ago" format)
- [x] Absolute date shown on hover (title attribute)
- [x] Falls back to absolute date for >30 days
- [x] STALE badge still appears when >9 days old

### Step 4 — Welcome Screen
- [x] First visit with Supabase (no data) shows "Welcome to FFA Scout Board" message
- [x] "Run First Analysis" button triggers analysis
- [x] Fallback mode still shows existing "no-data" state with CLI hint
- [x] Button disabled during analysis with "Analyzing..." text

### Step 5 — Error Banner
- [x] Red error banner shown when refresh fails
- [x] Banner displays error message from API
- [x] "Try Again" button re-triggers refresh
- [x] Dismiss button (&times;) clears the error
- [x] Banner positioned between header and tab bar

### Step 6 — Skeleton Loader
- [x] 6 skeleton cards shown during refresh
- [x] Skeleton matches OpportunityCard layout (logo, title, badges)
- [x] Uses Tailwind animate-pulse
- [x] Disappears when refresh completes

### Step 7 — Footer
- [x] Footer shows "FFA Scout Board v0.1 — Built for Free Football Agency"
- [x] Styled with scout-border top border
- [x] Appears on all pages (in layout.js)

## Dependencies & Risks

**Dependencies:**
- Step 1 (refresh handler) should come first — Steps 4, 5, and 6 depend on `handleRefresh` and `refreshState`
- Steps 2, 3, and 7 are independent of each other and of Step 1
- Step 8 is done last

**Risks:**
- **Low risk overall** — Frontend-only changes, no database migrations, no new API endpoints
- **`router.refresh()` timing** — After analysis completes, the server component re-runs. If analysis is slow (60s+), the page may feel unresponsive. The skeleton loader (Step 6) mitigates this.
- **409 from concurrent analysis** — If Levan clicks refresh while a CLI analysis is running, the 409 error message ("Analysis already in progress") will show in the error banner. This is correct behavior, not a bug.
- **Stale `pipeline_runs`** — If a previous analysis crashed without completing, the concurrent guard blocks new runs. This is an existing limitation documented in Session 2's plan.

## Sources & References

- Build.md Session 4 spec: `Build.md` lines 185-220
- Session 3 plan (completed): `docs/plans/2026-03-16-feat-tags-ui-my-pipeline-plan.md`
- Session 2 plan (completed): `docs/plans/2026-03-16-feat-supabase-storage-completion-plan.md`
- Dashboard component: `components/Dashboard.js` (header at lines 213-238, grid at 297-315)
- EmptyState: `components/EmptyState.js` (states at lines 3-30)
- Analyze API: `app/api/analyze/route.js` (POST with cache/concurrent guard)
- Server data loading: `app/page.js` (Server Component, Supabase queries at lines 31-85)
- Layout: `app/layout.js` (root layout, footer target at line 14)
- CSS animations: `app/globals.css` (slide-up keyframes at lines 10-19)
