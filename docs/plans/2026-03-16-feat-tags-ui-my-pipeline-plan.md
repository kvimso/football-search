---
title: "Tags UI + My Pipeline (Build.md Session 3)"
type: feat
status: completed
date: 2026-03-16
---

# Tags UI + My Pipeline

## Overview

Build.md Session 3 ("Tags UI + My Pipeline") is ~80% built. The core tag flow — Supabase persistence, TagPlayerModal with API integration, tagged player badges on cards, remove tag, tab bar with "My Matches", empty states — all work. This plan addresses the remaining 5 gaps: renaming the tab to "My Pipeline", sorting by recency in pipeline view, adding a stats panel, showing tag details (notes + date) in pipeline view, and fixing a missing field in the POST response.

## Problem Statement / Motivation

1. **Tab naming mismatch** — The tab says "My Matches" but Build.md spec calls it "My Pipeline". "Pipeline" better describes Levan's deal-tracking workflow (these are active placement deals, not match results).

2. **Wrong sort order in pipeline** — Pipeline view sorts by urgency (same as All Opportunities). Levan needs most recently tagged opportunities first — the deals he's actively working on right now should be at the top.

3. **No stats at a glance** — Levan opens the dashboard daily. There's no quick summary showing total opportunities, critical count, or how many players he's tracking. He has to mentally count.

4. **Tag details hidden in pipeline** — When Levan tags a player, he often adds notes ("Has EU passport", "Agent contact: Giorgi"). These notes are stored but never shown on the pipeline view. Neither is the tag date, which indicates deal freshness.

5. **`player_id` missing from POST response** — `POST /api/tags` returns the created tag without `player_id`. On the first render after tagging, the tag in state lacks the player link. Only corrected on page refresh when `GET /api/tags` returns the full shape.

## Proposed Solution

Five focused changes to existing files + one new component.

### Step 1 — Rename Tab + Internal State Value

**`components/Dashboard.js`**: Change tab label from "My Matches" to "My Pipeline". Also rename the internal `activeTab` value from `"matches"` to `"pipeline"` for semantic consistency (the value is never persisted to localStorage or URL params — safe to rename).

**References to update** (all in Dashboard.js):
- Line 17: initial state default (stays `"opportunities"`, no change)
- Line 141: `if (activeTab === "matches")` → `"pipeline"`
- Line 237: `onClick={() => setActiveTab("matches")}` → `"pipeline"`
- Lines 238-239: `activeTab === "matches"` → `"pipeline"`
- Line 244: `"My Matches"` → `"My Pipeline"`
- Line 256: `activeTab === "matches"` → `"pipeline"` (FilterBar totalCount)
- Line 268-270: `activeTab === "matches"` → `"pipeline"` (EmptyState type)
- Line 288: `activeTab === "matches"` → `"pipeline"` (showOutdated)

**`components/EmptyState.js`**: Update the `"no-tags"` description copy from "track your matches here" to "track your pipeline here".

### Step 2 — Sort Pipeline by Most Recently Tagged

**`components/Dashboard.js`**: Modify the `filtered` useMemo. When `activeTab === "pipeline"`, sort by `tagged_at` descending instead of urgency.

```js
// After filtering, before return:
if (activeTab === "pipeline") {
  // Build a lookup: opportunity_id → most recent tagged_at
  const taggedAtMap = new Map();
  for (const tag of tags) {
    const current = taggedAtMap.get(tag.opportunity_id);
    if (!current || tag.tagged_at > current) {
      taggedAtMap.set(tag.opportunity_id, tag.tagged_at);
    }
  }
  return [...result].sort((a, b) => {
    const dateA = taggedAtMap.get(a.id) || "";
    const dateB = taggedAtMap.get(b.id) || "";
    if (dateA !== dateB) return dateB.localeCompare(dateA); // most recent first
    return SORT_COMPARATOR(a, b); // fallback: urgency
  });
}

return [...result].sort(SORT_COMPARATOR);
```

**Design decisions:**
- Uses string comparison on ISO dates (lexicographic sort of ISO strings equals chronological sort)
- For multiple tags per opportunity, uses the most recent `tagged_at`
- Falls back to urgency sort for equal dates (sort stability)
- `Map` lookup built once per memo evaluation, not per comparison — O(tags) + O(n log n) total

### Step 3 — Stats Panel

**Create `components/StatsPanel.js`**: A compact row of 4 stat cards between FilterBar and the opportunity grid.

Stats shown:
| Stat | Source | Label |
|------|--------|-------|
| Total opportunities | `opportunities.length` | "Opportunities" |
| Critical count | `opportunities.filter(op => op.urgency === 3).length` | "Critical" |
| Players in pipeline | `new Set(tags.map(t => t.player_name)).size` | "Players Tagged" |
| Clubs analyzed | `new Set(opportunities.map(op => op.clubs?.name).filter(Boolean)).size` | "Clubs" |

**Design decisions:**
- Stats are **global** (unfiltered, tab-independent) — the FilterBar already shows filtered counts, so the stats panel provides complementary big-picture context
- Layout: horizontal row on desktop (4 cards), 2x2 grid on mobile
- Dark theme: `bg-scout-card border border-scout-border` (matches existing cards)
- "Players Tagged" uses unique player names (`player_name`), not tag count — Levan wants to know how many players he's placing, not how many tags exist

**`components/Dashboard.js`**: Import `StatsPanel` and render it between FilterBar and the grid.

### Step 4 — Show Tag Details in Pipeline View

**`components/OpportunityCard.js`**: Add a `showTagDetails` prop. When true (pipeline view), expand the tag display from compact chips to blocks showing notes and date.

Current (compact chip, All Opportunities tab):
```
[Giorgi K. ×]
```

Pipeline view (expanded):
```
Giorgi K.                          ×
Has EU passport, agent: Giorgi
Tagged Mar 14, 2026
```

**Implementation:**
- New prop: `showTagDetails` (boolean, default false)
- When `showTagDetails` is true, render each tag as a small card block instead of an inline chip
- Show `tag.notes` only if non-empty (hide line entirely when null/empty)
- Show `tagged_at` formatted with `toLocaleDateString` (consistent with header's "Last analyzed" format)
- Truncate notes to ~100 chars with ellipsis; show full text in `title` attribute on hover

**`components/Dashboard.js`**: Pass `showTagDetails={activeTab === "pipeline"}` to OpportunityCard.

### Step 5 — Fix `player_id` in POST Response

**`app/api/tags/route.js`**: Add `player_id` to the `.select()` on line 57.

Before: `.select("id, opportunity_id, player_name, notes, tagged_at")`
After: `.select("id, opportunity_id, player_name, player_id, notes, tagged_at")`

This ensures the optimistic state after tagging has the full shape, matching what GET returns on page reload.

### Step 6 — Update CLAUDE.md

Add `StatsPanel.js` to the project structure.

## Technical Considerations

**No new dependencies** — All changes use existing libraries (React, Tailwind, Supabase client). No date-fns needed; `toLocaleDateString` matches existing patterns.

**Performance** — The `taggedAtMap` in Step 2 is built from the `tags` array (typically < 100 items). The stats calculations in Step 3 iterate `opportunities` and `tags` arrays once each. Both are negligible at the expected scale (dozens to low hundreds of items).

**Responsive** — StatsPanel follows existing responsive patterns: `grid-cols-2 md:grid-cols-4`. OpportunityCard's expanded tag view fits within the existing card width on mobile.

**Fallback mode** — All changes work identically in both Supabase and localStorage/fallback modes. The tag shape is the same in both paths (both include `notes` and `tagged_at`).

## Acceptance Criteria

### Step 1 — Rename Tab
- [x] Tab label reads "My Pipeline" instead of "My Matches"
- [x] Internal state value changed from `"matches"` to `"pipeline"` across Dashboard.js
- [x] EmptyState `"no-tags"` copy updated to reference "pipeline"

### Step 2 — Pipeline Sort
- [x] Pipeline tab sorts opportunities by most recently tagged (descending)
- [x] Multiple tags per opportunity: uses most recent `tagged_at` for sort key
- [x] Falls back to urgency sort for equal dates
- [x] All Opportunities tab still sorts by urgency (no regression)

### Step 3 — Stats Panel
- [x] `components/StatsPanel.js` created with 4 stat cards
- [x] Shows: total opportunities, critical count, players tagged (unique), clubs analyzed
- [x] Renders between FilterBar and opportunity grid
- [x] Responsive: 4 columns desktop, 2x2 mobile
- [x] Uses dark theme (`bg-scout-card`, `border-scout-border`)

### Step 4 — Tag Details in Pipeline
- [x] `OpportunityCard` accepts `showTagDetails` prop
- [x] Pipeline view shows tag notes (when non-empty) and tagged date
- [x] Notes truncated at ~100 chars with ellipsis
- [x] Tagged date uses absolute format matching existing date display
- [x] All Opportunities tab still shows compact tag chips (no regression)

### Step 5 — Fix POST Response
- [x] `POST /api/tags` response includes `player_id` field
- [x] No regression on existing tag creation flow

### Step 6 — Documentation
- [x] CLAUDE.md project structure includes `StatsPanel.js`

## Dependencies & Risks

**Dependencies:**
- Step 1 (rename) should come first — other steps reference the new `"pipeline"` state value
- Steps 2-5 are independent and can be done in any order after Step 1
- Step 6 is done last

**Risks:**
- **Low risk overall** — These are focused frontend changes with no database migrations, no new API endpoints, and no external service calls
- **localStorage filter persistence**: The `activeTab` is NOT persisted to localStorage, so renaming the internal value is safe. Verified in Dashboard.js — only `filters` are saved to localStorage (line 51)
- **Tag shape consistency**: The `handleConfirmMatch` path already constructs tags with `notes` and `tagged_at` (lines 80-87), so the pipeline view's expanded display works for both manually tagged and AI-confirmed tags

## Sources & References

- Build.md Session 3 spec: `Build.md` lines 148-181
- Session 2 plan (completed): `docs/plans/2026-03-16-feat-supabase-storage-completion-plan.md`
- Dashboard component: `components/Dashboard.js` (central state management, tab logic)
- OpportunityCard: `components/OpportunityCard.js` (tag display at lines 128-147)
- EmptyState: `components/EmptyState.js` (no-tags copy at line 15)
- Tags API: `app/api/tags/route.js` (POST select at line 57, GET select at line 15)
- Matches API: `app/api/matches/route.js` (confirm handler creates player_tags via upsert at lines 76-84)
