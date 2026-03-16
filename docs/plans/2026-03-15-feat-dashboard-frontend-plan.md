---
title: "feat: Dashboard Frontend — Opportunity Cards, Filters, and Player Tagging"
type: feat
status: completed
date: 2026-03-15
---

# feat: Dashboard Frontend — Opportunity Cards, Filters, and Player Tagging

## Overview

Build the main user-facing dashboard for FFA Scout Board. Levan opens this daily to scan European clubs for transfer opportunities — which clubs need players, at what position, how urgently, and what they can pay. The dashboard replaces the current placeholder in `app/page.js` with a filterable card grid, expandable AI reasoning, player tagging, and a "My Matches" view.

This corresponds to BUILD.md Days 5-7.

## Problem Statement / Motivation

The backend data pipeline (Phase 1-2) is complete — squad data can be fetched, analyzed by Gemini/heuristic, and stored as opportunities in Supabase. But there is no UI. Levan currently has no way to view, filter, or act on these opportunities. The dashboard is the product.

## Proposed Solution

A single-page dashboard with two tabs:

1. **All Opportunities** — Filterable card grid showing active transfer gaps across all monitored clubs
2. **My Matches** — Opportunities Levan has tagged with his Georgian players

### Data Architecture

- **Server Component** (`app/page.js`) fetches opportunities from Supabase via `getSupabaseServerClient()` (joined with `clubs` for name/logo/league/country)
- **Fallback mode**: When Supabase is not configured, run `getFallbackAnalysis()` on `SAMPLE_CLUBS` server-side to generate demo opportunities
- **Client Components** handle interactivity: filters, card expand/collapse, tag modal, tab switching
- **Player tags**: Write to Supabase `player_tags` table via API route. In fallback mode, use `localStorage`

### Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Budget tier source | Opportunity-level `budget_tier` | AI's per-position assessment is more accurate than static club-level |
| Filter type | All multi-select | Levan needs "show me RBs and CFs with urgency 2 or 3" |
| Sort default | Urgency DESC, then league A-Z | Surface most actionable opportunities first |
| Card rendering | All at once (MVP) | 12 sample clubs = ~36-60 opportunities. Supabase mode may need pagination later |
| Reasoning expand | Independent (multiple open) | Levan may compare two opportunities side-by-side |
| Tags in fallback mode | localStorage | Allows demo use without Supabase |
| My Matches scope | Shows tagged opportunities even if `is_active=false` | Prevents confusion when re-analysis deactivates old opportunities |
| Stats tab | Deferred to Phase 4 (Days 8-9) | Keep this phase focused on core functionality |

## Technical Approach

### Component Architecture

```
app/page.js (Server Component)
├── Fetches opportunities + clubs from Supabase (or generates from sample data)
├── Fetches player_tags
└── Renders <Dashboard opportunities={...} tags={...} />

components/Dashboard.js (Client Component — "use client")
├── State: activeTab, filters, expandedCards
├── Filters opportunities client-side
├── <Header /> — title, last-analyzed timestamp, staleness warning
├── <FilterBar /> — league, position, urgency, budget multi-selects
├── <TabBar /> — "All Opportunities" | "My Matches"
├── <OpportunityGrid /> — filtered card list
│   └── <OpportunityCard /> — individual card
│       ├── Club name + logo, league, country
│       ├── Position + urgency badge + budget badge
│       ├── Expandable reasoning + ideal profile
│       ├── Tagged player indicators
│       └── "Tag Player" button → opens modal
├── <TagPlayerModal /> — form: player name + notes
└── <EmptyState /> — context-aware empty messages
```

### File Plan

| File | Purpose |
|------|---------|
| `app/page.js` | Server Component — data fetching, fallback logic |
| `app/api/tags/route.js` | POST/DELETE — create/remove player tags |
| `components/Dashboard.js` | Client Component — state management, layout |
| `components/FilterBar.js` | Multi-select filters for league, position, urgency, budget |
| `components/OpportunityCard.js` | Individual opportunity card with expand/collapse |
| `components/TagPlayerModal.js` | Modal form for tagging a player to an opportunity |
| `components/EmptyState.js` | Context-aware empty state messages |
| `app/globals.css` | Add slide-up keyframe animation |
| `tailwind.config.js` | Add animation config for slide-up |

### Data Flow

```
1. Page Load:
   Server Component → Supabase query (or sample data + heuristic)
   → Pass opportunities[] + tags[] as props to <Dashboard>

2. Filtering (client-side):
   User toggles filter → setState → filter opportunities in memory → re-render grid

3. Expand Reasoning:
   User clicks card → toggle expandedCards Set → animate open/close

4. Tag Player:
   User clicks "Tag Player" → modal opens → fills form → POST /api/tags
   → On success: update local tags state (optimistic) → close modal → show tag indicator on card

5. Remove Tag:
   User clicks X on tag (in My Matches) → DELETE /api/tags?id=... → remove from local state

6. Tab Switch:
   "My Matches" → filter to only tagged opportunities (including inactive ones)
```

### Supabase Query (Server Component)

```js
// app/page.js
const { data: opportunities } = await supabase
  .from("opportunities")
  .select(`
    id, position, urgency, budget_tier, reason, ideal_profile,
    transfer_window, analyzed_at, is_active,
    clubs!inner(id, name, logo_url, league, country)
  `)
  .eq("is_active", true)
  .order("urgency", { ascending: false });

const { data: tags } = await supabase
  .from("player_tags")
  .select("id, opportunity_id, player_name, notes, tagged_at");
```

### Fallback Mode (No Supabase)

```js
// app/page.js
import { SAMPLE_CLUBS } from "../lib/sample-data.js";
import { getFallbackAnalysis } from "../lib/fallback-analyzer.js";

const opportunities = SAMPLE_CLUBS.flatMap((club) => {
  const gaps = getFallbackAnalysis(club);
  return gaps.map((gap, i) => ({
    id: `${club.club_id}-${i}`,
    position: gap.position,
    urgency: gap.urgency,
    budget_tier: gap.budget_tier,
    reason: gap.reason,
    ideal_profile: gap.ideal_profile,
    analyzed_at: new Date().toISOString(),
    is_active: true,
    clubs: {
      id: club.club_id,
      name: club.name,
      logo_url: club.logo,
      league: club.league,
      country: club.country,
    },
  }));
});
```

### API Route for Tags

```js
// app/api/tags/route.js
// POST: { opportunity_id, player_name, notes }
// DELETE: ?id=<tag_id>
// Uses getSupabaseServerClient() — service role key
```

### Card Design

```
┌─────────────────────────────────────────────┐
│  [Club Logo]  FC Nantes                     │
│               Ligue 1 · France              │
│                                             │
│  Position: Right-Back                       │
│  [🔴 CRITICAL]  [🟡 MID budget]            │
│                                             │
│  ▼ AI Reasoning (click to expand)           │
│  ┌─────────────────────────────────────┐    │
│  │ Only 1 RB in squad (Dennis Appiah,  │    │
│  │ age 33), injured with ACL until     │    │
│  │ June. No backup.                    │    │
│  │                                     │    │
│  │ Ideal: Young (20-25) attacking      │    │
│  │ right-back ready to start           │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  👤 Giorgi K. tagged                        │
│  [+ Tag Player]                             │
└─────────────────────────────────────────────┘
```

### Color System

| Element | Tailwind Classes |
|---------|-----------------|
| **Urgency 3 (CRITICAL)** | `bg-red-500/20 text-red-400 border-red-500/30` |
| **Urgency 2 (MEDIUM)** | `bg-amber-500/20 text-amber-400 border-amber-500/30` |
| **Urgency 1 (LOW)** | `bg-blue-500/20 text-blue-400 border-blue-500/30` |
| **Budget HIGH** | `bg-green-500/20 text-green-400` |
| **Budget MID** | `bg-amber-500/20 text-amber-400` |
| **Budget LOW** | `bg-blue-500/20 text-blue-400` |
| **Card background** | `bg-scout-card border border-scout-border` |
| **Tag indicator** | `text-scout-accent` |

### Slide-Up Animation

```css
/* app/globals.css */
@keyframes slide-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
```

Cards use `animation: slide-up 0.4s ease-out forwards` with staggered `animation-delay` based on index.

## Implementation Phases

### Phase A: Foundation (app/page.js + Dashboard shell)

- [x] Update `app/page.js` to Server Component with data fetching
  - Supabase query: opportunities JOIN clubs, WHERE is_active=true, ORDER BY urgency DESC
  - Fallback: generate opportunities from SAMPLE_CLUBS + getFallbackAnalysis()
  - Fetch player_tags (or empty array in fallback mode)
  - Pass data as props to `<Dashboard>`
- [x] Create `components/Dashboard.js` ("use client")
  - State: `activeTab` ("opportunities" | "matches"), `filters`, `expandedCards` (Set), `tags` (array), `modalOpportunityId` (string|null)
  - Client-side filtering logic
  - Layout: Header → FilterBar → TabBar → OpportunityGrid
- [x] Add slide-up keyframe to `app/globals.css`
- [x] Add animation config to `tailwind.config.cjs` (renamed from .js for ESM compat)

### Phase B: Cards + Filters

- [x] Create `components/OpportunityCard.js`
  - Club logo (with fallback initials circle if image fails), name, league, country
  - Position label
  - Urgency badge with text label (CRITICAL/MEDIUM/LOW) — not color-only
  - Budget tier badge with text label (HIGH/MID/LOW)
  - Expandable reasoning section (click to toggle)
  - Ideal profile text (inside expanded section)
  - Tagged player indicators (if any tags exist for this opportunity)
  - "Tag Player" button
  - Slide-up animation with staggered delay
- [x] Create `components/FilterBar.js`
  - League multi-select (7 leagues from TARGET_LEAGUES)
  - Position multi-select (10 positions from POSITIONS)
  - Urgency multi-select (CRITICAL / MEDIUM / LOW)
  - Budget multi-select (HIGH / MID / LOW)
  - "Clear all" button when any filter is active
  - Filter counts (e.g., "47 opportunities" → "12 matching")
  - Persist filter selections to localStorage
- [x] Create `components/EmptyState.js`
  - No data: "No transfer opportunities available. Run the analysis pipeline to generate results."
  - No filter matches: "No opportunities match your filters." + Clear filters button
  - No matches (My Matches tab): "No players tagged yet. Tag a player on any opportunity to track your matches here."

### Phase C: Player Tagging

- [x] Create `app/api/tags/route.js`
  - POST: Validate `opportunity_id`, `player_name` (required, non-empty). Insert into `player_tags`. Handle UNIQUE constraint violation (409 error with message). Return created tag.
  - DELETE: Validate `id` param. Delete from `player_tags`. Return 200.
  - Both use `getSupabaseServerClient()`. Return 503 if Supabase not configured.
- [x] Create `components/TagPlayerModal.js`
  - Triggered by "Tag Player" button on card (receives opportunity_id)
  - Form fields: player name (required), notes (optional textarea)
  - Submit → POST /api/tags (or localStorage in fallback mode)
  - Optimistic UI: add tag to local state immediately, roll back on error
  - Close on success, show inline error on failure
  - Close on Escape key or backdrop click
  - Prevent duplicate: check existing tags client-side before submitting
- [x] Add tag management to Dashboard state
  - `tags` state with add/remove methods
  - Fallback mode: read/write tags from localStorage
  - Pass tag data to OpportunityCard for indicator display

### Phase D: My Matches Tab + Polish

- [x] Add `<TabBar>` component — "All Opportunities" | "My Matches" tabs
- [x] "My Matches" view
  - Filter to opportunities that have at least one tag
  - Include inactive opportunities (is_active=false) that are tagged — show "outdated" badge
  - Show tagged player name(s) + notes on each card
  - "Remove" button (X) on each tag to untag
  - Same filter bar applies
- [x] Data freshness indicator
  - Show "Last analyzed: March 14, 2026" in header area
  - Yellow warning badge if most recent `analyzed_at` is older than 9 days
  - Calculated from the most recent `analyzed_at` across all opportunities
- [x] Mobile responsiveness
  - Card grid: 1 col mobile, 2 col tablet, 3 col desktop (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)
  - Filter bar: horizontal scroll or wrap on mobile
  - Modal: full-width on mobile, centered max-w-md on desktop
  - Touch-friendly tap targets (min 44px)
- [x] Loading states
  - Skeleton card placeholders during initial load (if using client-side fetch)
  - Disabled filter bar while loading
  - Loading spinner on tag submit button
- [x] Club logo fallback
  - If `logo_url` is null or image fails to load, show club name initials in a colored circle
  - Use Next.js `<Image>` component (already configured in `next.config.mjs` for `media.api-sports.io`)

## Acceptance Criteria

### Functional

- [ ] Dashboard loads and shows opportunity cards from Supabase data
- [ ] Dashboard works with sample data when Supabase is not configured (fallback mode)
- [ ] Each card shows: club name, logo, league, country, position, urgency badge, budget badge
- [ ] Clicking a card expands AI reasoning text + ideal profile
- [ ] Urgency badges show text labels (CRITICAL/MEDIUM/LOW) alongside colors
- [ ] League filter works (multi-select, 7 leagues)
- [ ] Position filter works (multi-select, 10 positions)
- [ ] Urgency filter works (multi-select, 3 levels)
- [ ] Budget filter works (multi-select, 3 tiers)
- [ ] "Clear all" resets filters to showing everything
- [ ] Filter result count updates as filters change
- [ ] "Tag Player" opens modal with name + notes form
- [ ] Tagging writes to Supabase `player_tags` (or localStorage in fallback)
- [ ] Tags appear as indicators on tagged opportunity cards
- [ ] "My Matches" tab shows only tagged opportunities
- [ ] Tags can be removed (delete/untag)
- [ ] Multiple players can be tagged to the same opportunity
- [ ] Cards animate in with slide-up effect

### Non-Functional

- [ ] Mobile responsive — usable on phone screens
- [ ] Dark theme matches design spec (bg: #0a0f0d, cards: #111916, accent: #22c55e)
- [ ] Empty states show helpful messages (no data / no filter matches / no tags)
- [ ] Data freshness shown — "Last analyzed" timestamp with staleness warning >9 days
- [ ] Club logo fallback when image is missing or broken
- [ ] Filter selections persist in localStorage across page reloads
- [ ] Tag modal closes on Escape key and backdrop click

## Dependencies & Prerequisites

**Completed (Phase 1-2):**
- `lib/supabase.js` — browser and server client helpers
- `lib/sample-data.js` — 12 sample clubs with POSITIONS and TARGET_LEAGUES exports
- `lib/fallback-analyzer.js` — heuristic analysis (no API key needed)
- `supabase/migrations/001_initial_schema.sql` — full schema with opportunities + player_tags tables
- `tailwind.config.js` — scout color tokens configured
- `next.config.mjs` — image domains for club logos configured

**No new dependencies needed.** Using only Next.js, React, Tailwind, and Supabase (already installed). Card animations use CSS keyframes. No icon library — use text/emoji or simple SVG inline.

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Club logo images slow/broken | Medium | Low | Fallback initials circle + `<Image>` component handles errors |
| Too many opportunities (500+) on Supabase mode | Low (MVP) | Medium | MVP renders all. Add pagination if needed post-launch |
| localStorage tag loss (browser cleared) | Low | Medium | Note in UI: "Tags are stored locally." Supabase mode persists to DB |
| Filter state complexity | Low | Low | Simple object state, client-side array filter. No external state library needed |
| Tagged opportunities disappear after re-analysis | Medium | High | My Matches shows tagged ops regardless of is_active. Inactive ones get "outdated" badge |

## Sources & References

### Internal References

- Design spec: `CLAUDE.md` — dark theme colors, urgency/budget badge colors
- Sample data: `lib/sample-data.js:832-844` — POSITIONS and TARGET_LEAGUES arrays
- Fallback analyzer: `lib/fallback-analyzer.js:4-77` — heuristic gap detection
- Supabase clients: `lib/supabase.js` — browser (anon key) and server (service role) clients
- DB schema: `supabase/migrations/001_initial_schema.sql` — opportunities, player_tags tables
- Image config: `next.config.mjs` — `media.api-sports.io` domain allowed
- Existing page: `app/page.js` — placeholder to replace
- Phase 1-2 plan: `docs/plans/2026-03-15-feat-data-foundation-and-gemini-pipeline-plan.md`

### Key Schema References

- `opportunities.budget_tier` — per-opportunity budget tier (AI assessment), used on cards
- `clubs.budget_tier` — club-level default, NOT displayed on cards
- `player_tags(opportunity_id, player_name)` — UNIQUE constraint, prevent duplicates
- `opportunities.is_active` — soft-delete flag, My Matches ignores this for tagged ops
