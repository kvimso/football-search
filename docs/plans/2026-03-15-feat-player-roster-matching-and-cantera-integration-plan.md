---
title: "feat: Player Roster, AI Matching Engine, and Cantera Integration"
type: feat
status: completed
date: 2026-03-15
---

# feat: Player Roster, AI Matching Engine, and Cantera Integration

## Overview

Build a structured player roster system, an AI-powered matching engine that auto-suggests which of Levan's Georgian players fit each club opportunity, and a Cantera integration layer that imports academy player data into FFA Scout Board. This combines BUILD.md Phase 2 (Player-Club Matching) and Phase 4 (Cantera Integration) into a single implementation plan, since Phase 2 is a prerequisite for Phase 4.

Currently, Levan manually types player names into a free-text field to tag them to opportunities. This plan replaces that with structured player profiles (stats, video, scouting notes), AI-generated match scores (1-100), and an automated data pipeline from the Cantera Georgian scouting platform.

## Problem Statement / Motivation

The dashboard (Phase 3, completed) shows Levan which clubs need players. But it doesn't help him answer the critical follow-up question: **"Which of my players is the best fit for this opportunity?"**

Today, Levan:
1. Sees an opportunity card (e.g., "FC Nantes needs a Right-Back, CRITICAL urgency")
2. Mentally scans his roster of ~20-40 Georgian players
3. Makes a judgment call and tags a player name (free text, no data)
4. Has no data to support his pitch to the club's sporting director

With this feature, Levan:
1. Sees the opportunity card **with AI-suggested matches** ranked by fit score
2. Clicks to see **why** each player is a good match (AI reasoning)
3. Accepts a match and gets structured data for his pitch
4. New academy players from Cantera auto-populate his roster and get matched automatically

This is the step from "information tool" to "decision support system" — the core competitive advantage described in BUILD.md.

## Proposed Solution

### Three Layers

1. **Player Roster** — A `players` table with full profiles (name, age, position, stats, video, scouting notes, contract status). CRUD API + management page. Replaces free-text player names.

2. **Matching Engine** — Hybrid scoring: heuristic first pass (position + age + league level) → Gemini AI refinement for top candidates with reasoning text. Results stored in `player_matches` table. Runs as a pipeline step after analysis.

3. **Cantera Integration** — Transport-agnostic importer interface. Start with CSV import (since Cantera API details are TBD). Design for future REST API or shared Supabase integration. Normalize Cantera data to FFA player schema.

### Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Matching approach | Hybrid: heuristic + AI refinement | Pure AI is too expensive at scale (30 players × 200 opportunities = 6,000 pairs). Heuristic narrows to top 5-10, then AI provides reasoning. |
| Match storage | Persistent `player_matches` table | Scores need to survive page reloads and be queryable. On-the-fly computation is too slow for dashboard load. |
| Player position model | `primary_position` + `secondary_position` | Players often play multiple positions. Matching against both (with score penalty for secondary) dramatically increases match quality. |
| Player stats format | JSONB blob | Different players have different stats available. JSONB allows flexible schema without migration for every new stat type. |
| Cantera transport | Start with CSV import, design for REST API later | Cantera API details are TBD. CSV is lowest integration effort and gets the data flowing immediately. |
| `player_tags` migration | Add nullable `player_id` FK, keep `player_name` | Non-breaking change. Existing tags keep working. New tags from roster include both `player_id` and `player_name`. |
| Navigation | Add top-level nav bar: Opportunities / Players / (Pipeline later) | Single-page dashboard needs to evolve. Tab bar is too cramped for a third major view. |
| AI match suggestions on cards | Top 3 below existing tags, dashed border style | Visually distinct from manual tags. "Accept" promotes to tag, "Dismiss" hides until next match run. |
| Fallback mode | Include 5 sample Georgian players + heuristic matching | Demo experience must showcase matching without API keys. |
| Match score display | Numeric score (72/100) with color badge | Consistent with existing urgency/budget badge pattern. Green (80+), amber (50-79), blue (<50). |
| Cantera conflict resolution | Field-level ownership | Cantera owns: academy data, stats. FFA owns: agent notes, video links, contract status. Merge on sync, never overwrite FFA-owned fields. |
| Match suggestions per opportunity | Top 3 by default, expandable to all | Keeps cards clean. Levan can see all matches if interested. |

## Technical Approach

### Architecture

```
Current:
  Opportunities ← manual free-text tags (player_tags)

After this feature:
  Opportunities ← AI match suggestions (player_matches)
                ← structured tags (player_tags + player_id FK)
  Players       ← manual entry (CRUD API)
                ← Cantera import (CSV / REST API / shared Supabase)
  Matching      ← heuristic scoring (lib/match-engine.js)
                ← AI refinement (Gemini batch prompt)
                ← pipeline script (scripts/run-matching.js)
```

### Database Schema Changes

```sql
-- supabase/migrations/002_players_and_matching.sql

-- Structured player profiles
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  age INTEGER,
  primary_position TEXT NOT NULL,       -- Uses POSITIONS enum values
  secondary_position TEXT,              -- Optional second position
  nationality TEXT DEFAULT 'Georgia',
  current_club TEXT,                    -- Where the player currently plays
  contract_status TEXT,                 -- 'free_agent', 'under_contract', 'loan', 'expiring'
  contract_until DATE,                 -- Contract end date if known
  stats JSONB DEFAULT '{}',            -- Flexible: { goals, assists, appearances, ... }
  video_links TEXT[] DEFAULT '{}',     -- Array of highlight reel URLs
  scouting_notes TEXT,                 -- Free-text agent notes
  photo_url TEXT,                      -- Player headshot
  source TEXT DEFAULT 'manual',        -- 'manual' | 'cantera' | 'csv_import'
  cantera_id TEXT UNIQUE,              -- External ID from Cantera (NULL for manual entries)
  cantera_active BOOLEAN DEFAULT TRUE, -- FALSE if removed from Cantera
  is_active BOOLEAN DEFAULT TRUE,      -- Soft-delete for FFA
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI-generated match results
CREATE TABLE player_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  match_score INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  match_reasoning TEXT,                -- AI explanation of why this player fits
  source TEXT DEFAULT 'heuristic',     -- 'heuristic' | 'gemini' | 'claude'
  is_confirmed BOOLEAN DEFAULT FALSE,  -- Levan accepted this suggestion
  is_dismissed BOOLEAN DEFAULT FALSE,  -- Levan dismissed this suggestion
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, opportunity_id)
);

-- Add player_id FK to existing player_tags (backward compatible)
ALTER TABLE player_tags
  ADD COLUMN player_id UUID REFERENCES players(id) ON DELETE SET NULL;

-- Update pipeline_runs to support new run types
ALTER TABLE pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_run_type_check;
ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_run_type_check
  CHECK (run_type IN ('fetch', 'analyze', 'match', 'cantera_sync'));

-- Indexes
CREATE INDEX idx_players_position ON players(primary_position);
CREATE INDEX idx_players_nationality ON players(nationality);
CREATE INDEX idx_players_cantera_id ON players(cantera_id) WHERE cantera_id IS NOT NULL;
CREATE INDEX idx_players_active ON players(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_player_matches_opportunity ON player_matches(opportunity_id);
CREATE INDEX idx_player_matches_player ON player_matches(player_id);
CREATE INDEX idx_player_matches_score ON player_matches(match_score DESC);
CREATE INDEX idx_player_tags_player_id ON player_tags(player_id) WHERE player_id IS NOT NULL;
```

### Component Architecture

```
app/page.js (Server Component — existing)
├── Fetches opportunities, tags, AND now players + matches
└── Renders <Dashboard /> with extended props

app/players/page.js (NEW — Server Component)
├── Fetches players from Supabase or sample data
└── Renders <PlayerRoster />

app/players/[id]/page.js (NEW — Server Component)
├── Fetches single player + their matches (joined with opportunities + clubs)
└── Renders <PlayerDetail />

components/Dashboard.js (MODIFIED)
├── Now receives `players` and `matches` props
├── OpportunityCard shows match suggestions
└── Enhanced TagPlayerModal with roster picker

components/PlayerRoster.js (NEW — "use client")
├── Player card grid with search/filter
├── "Add Player" button → AddPlayerModal
├── Click player → navigate to /players/[id]
└── Stats: total players, positions covered

components/PlayerCard.js (NEW)
├── Player photo + name + position + age
├── Match count badge
├── Current club, contract status
└── Source indicator (manual / Cantera)

components/PlayerDetail.js (NEW — "use client")
├── Full player profile (all fields)
├── Matching opportunities list (sorted by score)
├── Edit/delete actions
├── Cantera sync status (if Cantera player)
└── Video links section

components/AddPlayerModal.js (NEW)
├── Form: name, age, position (select from POSITIONS), nationality
├── Optional: current club, contract status, stats, video links, notes
├── Submit → POST /api/players
├── Fallback mode: localStorage

components/MatchSuggestions.js (NEW)
├── Renders on OpportunityCard below existing tags
├── Top 3 matches with score badge + player name
├── "Accept" (→ creates tag) and "Dismiss" buttons
├── Expandable to show all matches

components/NavBar.js (NEW)
├── Top-level navigation: Opportunities | Players
├── Active state highlighting
├── Mobile hamburger menu

components/TagPlayerModal.js (MODIFIED)
├── Add roster player picker (searchable dropdown)
├── Falls back to free-text if no roster players exist
├── Pre-fills player_id when selecting from roster
```

### File Plan

| File | Purpose |
|------|---------|
| `supabase/migrations/002_players_and_matching.sql` | Schema: players, player_matches tables + player_tags FK |
| `lib/match-engine.js` | Heuristic scoring: position + age + league level + stats |
| `lib/match-ai-refiner.js` | Gemini prompt for top-N match refinement + reasoning |
| `lib/importers/cantera.js` | Cantera data importer (CSV parser, normalize to player schema) |
| `lib/importers/csv-parser.js` | Generic CSV-to-player parser (reusable for manual CSV import too) |
| `lib/sample-players.js` | 5 sample Georgian players for fallback/demo mode |
| `scripts/run-matching.js` | Pipeline: load players + opportunities → score → store matches |
| `scripts/import-cantera.js` | Pipeline: read Cantera source → upsert players → trigger matching |
| `app/api/players/route.js` | GET (list) / POST (create) player API |
| `app/api/players/[id]/route.js` | GET / PUT / DELETE single player API |
| `app/api/matches/route.js` | GET matches for opportunity/player, POST confirm/dismiss |
| `app/players/page.js` | Player roster page (Server Component) |
| `app/players/[id]/page.js` | Player detail page (Server Component) |
| `components/NavBar.js` | Top-level navigation bar |
| `components/PlayerRoster.js` | Player roster grid + search/filter |
| `components/PlayerCard.js` | Individual player card |
| `components/PlayerDetail.js` | Player detail view with matches |
| `components/AddPlayerModal.js` | Add/edit player form |
| `components/MatchSuggestions.js` | Match suggestion chips on opportunity cards |
| `components/TagPlayerModal.js` | MODIFIED: add roster picker |
| `components/Dashboard.js` | MODIFIED: pass matches, show suggestions |
| `components/OpportunityCard.js` | MODIFIED: render MatchSuggestions |
| `app/page.js` | MODIFIED: fetch players + matches |
| `app/layout.js` | MODIFIED: add NavBar |

### Data Flow

```
1. Player Entry:
   Manual: Levan fills form → POST /api/players → insert into players table
   Cantera: CSV import → scripts/import-cantera.js → upsert into players table
   Both: trigger matching for new/updated player

2. Matching Pipeline (scripts/run-matching.js):
   Load all active players
   Load all active opportunities (joined with clubs)
   For each opportunity:
     → Heuristic score all players (position match + age + league compatibility)
     → Take top 10 by heuristic score
     → Send top 10 to Gemini for AI refinement + reasoning
     → Store results in player_matches (upsert on UNIQUE constraint)
   Log to pipeline_runs (run_type: 'match')

3. Heuristic Scoring (lib/match-engine.js):
   Base score = 0
   +40 if primary_position matches opportunity.position
   +25 if secondary_position matches opportunity.position
   +20 if age fits ideal_profile age range (parsed from text)
   +15 if nationality/league level is compatible with budget_tier
   +5 bonus for each relevant stat above threshold
   Result: 0-100 score

4. AI Refinement (lib/match-ai-refiner.js):
   Gemini prompt: "Given this opportunity and these player profiles,
   score each player 0-100 and explain why they fit or don't."
   Fallback chain: Gemini → Claude → keep heuristic score
   Output: refined score + match_reasoning text

5. Dashboard Display:
   Server Component fetches opportunities + player_matches (joined with players)
   → Pass to Dashboard → OpportunityCard renders MatchSuggestions
   → Top 3 matches shown with score badge, player name, reasoning preview
   → "Accept" → POST /api/tags (with player_id) → creates structured tag
   → "Dismiss" → POST /api/matches (is_dismissed: true) → hide suggestion

6. Player Detail View:
   Server Component fetches player + player_matches (joined with opportunities + clubs)
   → Renders PlayerDetail with list of matching opportunities sorted by score
   → Levan sees which clubs his player could fit, with reasoning

7. Cantera Sync:
   scripts/import-cantera.js:
     → Read source (CSV file / REST API response / Supabase query)
     → Normalize each record to player schema (position normalization via POSITIONS enum)
     → Upsert into players table (match on cantera_id)
     → Field-level merge: Cantera overwrites stats/academy data, preserves FFA-owned fields
     → Log to pipeline_runs (run_type: 'cantera_sync')
     → Trigger run-matching.js for new/updated players
```

### Position Normalization

Both player entry and Cantera import must normalize positions to the canonical `POSITIONS` enum from `lib/sample-data.js`:

```js
// lib/position-normalizer.js
const POSITION_MAP = {
  // Common variations → canonical name
  "GK": "Goalkeeper", "Keeper": "Goalkeeper",
  "CB": "Centre-Back", "Center-Back": "Centre-Back", "Central Defender": "Centre-Back",
  "LB": "Left-Back", "Left Defender": "Left-Back",
  "RB": "Right-Back", "Right Defender": "Right-Back",
  "CDM": "Defensive Midfielder", "DM": "Defensive Midfielder", "Holding Midfielder": "Defensive Midfielder",
  "CM": "Central Midfielder", "Midfielder": "Central Midfielder",
  "CAM": "Attacking Midfielder", "AM": "Attacking Midfielder", "Number 10": "Attacking Midfielder",
  "LW": "Left Winger", "Left Wing": "Left Winger",
  "RW": "Right Winger", "Right Wing": "Right Winger",
  "ST": "Centre-Forward", "Striker": "Centre-Forward", "CF": "Centre-Forward", "Forward": "Centre-Forward",
};
```

### Matching Engine: Gemini Prompt

```
You are a football transfer matching analyst. Given a club's transfer opportunity
and a list of candidate players, score each player's fit from 0-100.

OPPORTUNITY:
Club: {club_name} ({league}, {country})
Position needed: {position}
Urgency: {urgency}/3
Budget tier: {budget_tier}
AI reasoning: {reason}
Ideal profile: {ideal_profile}

CANDIDATE PLAYERS:
{for each player:}
  - {name}, age {age}, position: {primary_position} (secondary: {secondary_position})
    Current club: {current_club}, contract: {contract_status}
    Stats: {stats JSON}
    Scouting notes: {scouting_notes}

For each player, return JSON:
{
  "player_name": "...",
  "score": 0-100,
  "reasoning": "2-3 sentence explanation of why this player fits or doesn't"
}

Scoring guidelines:
- 90-100: Perfect fit — right position, ideal age, stats match, league level appropriate
- 70-89: Strong fit — position matches, minor gaps (age slightly off, stats adequate)
- 50-69: Moderate fit — can play the position but not primary, or other gaps
- 30-49: Weak fit — significant mismatches but not impossible
- 0-29: Poor fit — wrong position, wrong profile, unrealistic move
```

### Match Score Badge Colors

| Score Range | Label | Tailwind Classes |
|-------------|-------|-----------------|
| 80-100 | Strong Match | `bg-green-500/20 text-green-400 border-green-500/30` |
| 50-79 | Moderate Match | `bg-amber-500/20 text-amber-400 border-amber-500/30` |
| 0-49 | Weak Match | `bg-blue-500/20 text-blue-400 border-blue-500/30` |

### Cantera Importer Interface

```js
// lib/importers/cantera.js
// Transport-agnostic: accepts normalized player records regardless of source

export async function importFromCSV(filePath) {
  // Parse CSV → normalize positions → return player records
}

export async function importFromAPI(apiUrl, apiKey) {
  // Fetch from REST API → normalize → return player records
  // Implementation TBD when Cantera API is defined
}

export async function importFromSupabase(supabaseUrl, supabaseKey, tableName) {
  // Query remote Supabase → normalize → return player records
  // Implementation TBD when Cantera Supabase details are defined
}

// All importers return the same shape:
// { players: NormalizedPlayer[], errors: ImportError[] }

export async function upsertPlayers(supabase, normalizedPlayers) {
  // For each player:
  //   - Match on cantera_id (if present) or name + age
  //   - If exists: merge (Cantera fields overwrite, FFA fields preserved)
  //   - If new: insert with source='cantera'
  // Returns: { inserted: number, updated: number, errors: ImportError[] }
}
```

### Fallback Mode

In fallback mode (no Supabase):
- 5 sample Georgian players loaded from `lib/sample-players.js`
- Players stored in localStorage (same pattern as tags)
- Heuristic matching runs client-side (no Gemini needed)
- Match suggestions shown on opportunity cards
- Player roster page works with localStorage data
- Cantera import not available (requires Supabase)

```js
// lib/sample-players.js
export const SAMPLE_PLAYERS = [
  {
    id: "sample-player-1",
    name: "Giorgi Kochorashvili",
    age: 25,
    primary_position: "Central Midfielder",
    secondary_position: "Defensive Midfielder",
    nationality: "Georgia",
    current_club: "Levante UD",
    contract_status: "under_contract",
    stats: { appearances: 28, goals: 3, assists: 5 },
    scouting_notes: "Box-to-box midfielder with strong defensive work rate. Good passing range.",
    source: "manual",
  },
  // ... 4 more sample players
];
```

## Implementation Phases

### Phase A: Database Schema + Player CRUD API

- [x] Create `supabase/migrations/002_players_and_matching.sql`
  - `players` table (full schema from Technical Approach above)
  - `player_matches` table
  - `player_tags.player_id` FK column
  - `pipeline_runs.run_type` CHECK constraint update
  - All indexes
- [x] Create `lib/sample-players.js` — 5 sample Georgian players for fallback mode
- [x] Create `lib/position-normalizer.js` — position string normalization
- [x] Create `app/api/players/route.js`
  - GET: list all active players, optional filter by position/nationality
  - POST: create new player (validate required fields, normalize position)
  - Fallback: return sample players / store in localStorage
- [x] Create `app/api/players/[id]/route.js`
  - GET: single player with match data
  - PUT: update player (validate, normalize position, update `updated_at`)
  - DELETE: soft-delete (`is_active: false`)
  - Fallback: localStorage operations

### Phase B: Player Management UI

- [x] Create `components/NavBar.js` — top-level navigation (Opportunities | Players)
- [x] Modify `app/layout.js` — integrate NavBar
- [x] Create `app/players/page.js` — Server Component, fetch players
- [x] Create `components/PlayerRoster.js` — card grid with search by name, filter by position
- [x] Create `components/PlayerCard.js` — player card (photo, name, position, age, club, match count)
- [x] Create `components/AddPlayerModal.js` — form with all fields
  - Required: name, primary_position
  - Optional: age, secondary_position, nationality, current_club, contract_status, contract_until, stats (JSON editor or key-value pairs), video_links (add/remove URLs), scouting_notes, photo_url
  - Position fields use `<select>` with POSITIONS enum values
  - Fallback mode: localStorage
- [x] Create `app/players/[id]/page.js` — Server Component, fetch player + matches
- [x] Create `components/PlayerDetail.js` — full profile view
  - All player fields displayed
  - Edit button → opens AddPlayerModal in edit mode
  - Delete button with confirmation
  - Video links as clickable list
  - Stats displayed as key-value pairs
  - Source badge (manual / Cantera)
  - Cantera sync status if applicable

### Phase C: Matching Engine

- [x] Create `lib/match-engine.js` — heuristic scoring function
  - Input: player object + opportunity object (with club data)
  - Output: { score: number, factors: string[] }
  - Scoring: position match (40pts) + age fit (20pts) + league compatibility (15pts) + stats bonus (5pts) + secondary position (25pts if no primary match)
  - Parse `ideal_profile` text for age range extraction
  - Uses POSITIONS for exact matching, position-normalizer for fuzzy matching
- [x] Create `lib/match-ai-refiner.js` — Gemini batch prompt for top-N refinement
  - Input: opportunity + array of top 10 heuristic-scored players
  - Output: refined scores + reasoning text for each
  - Fallback chain: Gemini → Claude → return heuristic scores as-is
  - Batch: one Gemini call per opportunity (all candidate players in one prompt)
- [x] Create `scripts/run-matching.js` — matching pipeline
  - Load active players from Supabase (or sample players)
  - Load active opportunities (joined with clubs)
  - For each opportunity: heuristic score all players → take top 10 → AI refine
  - Upsert results into `player_matches` (preserve is_confirmed/is_dismissed)
  - Log to `pipeline_runs` with `run_type: 'match'`
  - Support `--sample` flag for demo mode
  - Support `--player <id>` flag to match a single new player
  - Support `--opportunity <id>` flag to match against a single new opportunity
- [x] Add `npm run run-matching` script to `package.json`
- [x] Add `npm run run-matching -- --sample` for demo mode

### Phase D: Dashboard Match Integration

- [x] Modify `app/page.js` — fetch `player_matches` (joined with players) alongside opportunities
- [x] Create `components/MatchSuggestions.js`
  - Receives: matches for this opportunity (sorted by score DESC)
  - Renders top 3 matches: player name + score badge + reasoning preview (truncated)
  - "Accept" button: creates player_tag with player_id, marks match as confirmed
  - "Dismiss" button: marks match as dismissed (hidden)
  - "Show all" expander for remaining matches
  - Empty state: "No matching players. Add players to your roster."
  - Dashed border styling to visually distinguish from manual tags
- [x] Modify `components/OpportunityCard.js`
  - Add MatchSuggestions below existing tag indicators
  - Pass matches filtered to this opportunity's ID
- [x] Modify `components/Dashboard.js`
  - Receive `players` and `matches` props
  - Pass matches to OpportunityCard components
  - Handle match confirm/dismiss callbacks
- [x] Create `app/api/matches/route.js`
  - POST: confirm or dismiss a match (update is_confirmed/is_dismissed)
  - GET: matches for an opportunity or player (with filters)
- [x] Modify `components/TagPlayerModal.js`
  - Add "Select from roster" dropdown/autocomplete at top of form
  - When roster player selected: auto-fill player_name, attach player_id
  - Keep free-text fallback below ("Or enter manually")
  - In fallback mode: only free-text (no roster in localStorage... actually we do have roster in localStorage, so show the picker)
- [x] Add match data to PlayerDetail page
  - List of matching opportunities sorted by score
  - Each showing: club name + league + position + urgency + match score + reasoning
  - Click-through to opportunity card on dashboard

### Phase E: Cantera Integration

- [x] Create `lib/importers/csv-parser.js` — generic CSV to player array parser
  - Column mapping configuration (CSV column name → player field)
  - Position normalization via `lib/position-normalizer.js`
  - Validation: required fields, data type checks
  - Returns: `{ players: NormalizedPlayer[], errors: ImportError[] }`
- [x] Create `lib/importers/cantera.js` — Cantera-specific importer
  - `importFromCSV(filePath)` — uses csv-parser with Cantera column mapping
  - `importFromAPI(apiUrl, apiKey)` — placeholder, throws "Not yet configured"
  - `importFromSupabase(url, key, table)` — placeholder, throws "Not yet configured"
  - `upsertPlayers(supabase, normalizedPlayers)` — match on `cantera_id`, field-level merge
    - Cantera-owned fields (overwritten on sync): `name`, `age`, `primary_position`, `secondary_position`, `stats`, `current_club`
    - FFA-owned fields (preserved on sync): `scouting_notes`, `video_links`, `contract_status`, `contract_until`, `photo_url`
    - Set `source: 'cantera'`, update `cantera_active` based on presence in import
- [x] Create `scripts/import-cantera.js` — Cantera sync pipeline
  - Accept `--csv <path>` for CSV file import
  - Accept `--api` for REST API import (when configured)
  - Upsert players → log to pipeline_runs → trigger matching for new/updated players
  - Report: X inserted, Y updated, Z errors
- [x] Add `npm run import-cantera` script to `package.json`
- [x] Add Cantera env vars to `.env.local.example`:
  - `CANTERA_API_URL` (optional, for future REST API)
  - `CANTERA_API_KEY` (optional, for future REST API)

### Phase F: Migration + Polish

- [x] Create `scripts/migrate-tags.js` — migrate existing free-text player_tags to structured references
  - Read all player_tags rows where `player_id IS NULL`
  - For each: exact name match against `players` table
  - For matches: update `player_id` FK
  - For unmatched: log for manual review (output list of unmatched names)
  - Safe: does not delete or modify `player_name` field
- [x] Update `components/EmptyState.js` — add new empty states:
  - `"no-players"`: "No players in your roster yet. Add your first player to start seeing match suggestions."
  - `"no-player-matches"`: "No matching opportunities for this player. Check back after the next analysis run."
  - `"no-opportunity-matches"`: "No matching players. Add players to your roster to see suggestions."
- [x] Update fallback mode in Dashboard to include match suggestions from heuristic scoring
- [x] Mobile-responsive testing for all new pages/components
- [x] Update CLAUDE.md — add new files, scripts, and env vars to project structure

## Alternative Approaches Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Pure AI scoring (no heuristic) | Too expensive: 30 players × 200 opportunities = 6,000 AI calls per matching run |
| Pure heuristic scoring (no AI) | Missing the "why" — reasoning text is critical for Levan's pitches to clubs |
| Replace `player_tags` with `player_matches` entirely | Breaks existing manual tagging workflow. Tags and matches serve different purposes. |
| Real-time matching (on every page load) | Too slow. Batch pipeline + cached results is much better UX. |
| Build Cantera REST API first | API details are TBD. CSV import gets data flowing immediately. |
| Single-position player model | Misses valid matches. A wing-back who can play left-back should match LB opportunities. |
| Shared Supabase assumption for Cantera | Too coupled. Transport-agnostic design lets us switch when Cantera details are finalized. |

## System-Wide Impact

### Interaction Graph

```
Player CRUD (POST /api/players)
  → Insert into players table
  → (optional) Trigger matching for this player via run-matching.js --player <id>

Cantera Import (scripts/import-cantera.js)
  → Upsert into players table
  → Trigger run-matching.js for updated players
  → Log to pipeline_runs

Matching Pipeline (scripts/run-matching.js)
  → Reads players + opportunities
  → Calls match-engine.js (heuristic)
  → Calls match-ai-refiner.js (Gemini/Claude)
  → Upserts into player_matches
  → Log to pipeline_runs

Analysis Pipeline (scripts/run-analysis.js) — EXISTING
  → Deactivates old opportunities (is_active: false)
  → Creates new opportunities
  → [NEW] Should chain to run-matching.js afterward

Dashboard Load (app/page.js)
  → Fetches opportunities + tags + [NEW] matches + [NEW] players
  → Renders cards with match suggestions

Match Confirm (POST /api/matches)
  → Updates player_matches.is_confirmed
  → Creates player_tag with player_id

Match Dismiss (POST /api/matches)
  → Updates player_matches.is_dismissed
```

### Error & Failure Propagation

| Layer | Error | Handling |
|-------|-------|----------|
| Player CRUD API | Validation failure | 400 with field-level error messages |
| Player CRUD API | Supabase error | 500, log error, return generic message |
| Matching heuristic | Invalid player/opportunity data | Skip pair, log warning, continue batch |
| Matching AI (Gemini) | API failure | Fallback to Claude → fallback to heuristic scores |
| Matching AI (Gemini) | Invalid JSON response | Retry once, then fallback |
| Cantera CSV import | Parse error | Skip row, add to errors array, continue |
| Cantera CSV import | Position normalization failure | Use raw value, flag for review |
| Cantera upsert | Duplicate cantera_id conflict | Update existing record (upsert) |
| Match confirm | Opportunity now inactive | Still allow (My Matches shows inactive tagged ops) |
| Pipeline script | Partial failure mid-batch | Commit successful results, log failures, non-zero exit |

### State Lifecycle Risks

| Risk | Scenario | Mitigation |
|------|----------|------------|
| Orphaned matches | Opportunity deactivated but player_matches remain | ON DELETE CASCADE on FK. Matches for inactive ops are naturally filtered out. |
| Stale match scores | Opportunity re-analyzed with different ideal_profile | `run-matching.js` upserts (replaces old scores). Chain matching after analysis. |
| Duplicate players | Cantera imports player already manually entered | Match on `cantera_id` first, then name + age. Flag ambiguous matches. |
| Partial sync | Cantera import crashes mid-batch | Each player upserted individually. Partial progress is safe. |
| Tag migration data loss | Free-text name doesn't match any player | Never delete `player_name` field. `player_id` is additive. Unmatched names logged. |

### API Surface Parity

| Interface | Supabase Mode | Fallback Mode |
|-----------|:---:|:---:|
| GET /api/players | Supabase query | Sample players + localStorage |
| POST /api/players | Insert into Supabase | Add to localStorage |
| PUT /api/players/[id] | Update in Supabase | Update localStorage |
| DELETE /api/players/[id] | Soft-delete in Supabase | Remove from localStorage |
| GET /api/matches | Supabase query | Client-side heuristic matching |
| POST /api/matches (confirm/dismiss) | Update in Supabase | Update localStorage |
| Cantera import | Upsert into Supabase | Not supported (503) |

## Acceptance Criteria

### Functional Requirements

- [ ] New `players` table with full schema (name, age, positions, stats, video, notes, contract, source)
- [ ] CRUD API for players (`/api/players`, `/api/players/[id]`)
- [ ] Player roster page at `/players` with card grid, search, and position filter
- [ ] Player detail page at `/players/[id]` with full profile and matching opportunities
- [ ] Add/edit player modal with position select, stats, video links, scouting notes
- [ ] Heuristic matching engine scores players 0-100 against opportunities
- [ ] Gemini AI refines top 10 matches per opportunity with reasoning text
- [ ] `run-matching.js` script runs full matching pipeline
- [ ] Match suggestions appear on opportunity cards (top 3 per card)
- [ ] Match score badges (green/amber/blue) follow existing badge pattern
- [ ] "Accept" on a suggestion creates a structured player tag
- [ ] "Dismiss" on a suggestion hides it
- [ ] TagPlayerModal includes roster picker dropdown alongside free-text input
- [ ] Player detail page shows matching opportunities sorted by score
- [ ] CSV import for Cantera data via `import-cantera.js` script
- [ ] Cantera import normalizes positions to POSITIONS enum
- [ ] Cantera import preserves FFA-owned fields on re-sync
- [ ] `player_tags` gains `player_id` FK (nullable, backward compatible)
- [ ] Migration script converts existing free-text tags to structured references
- [ ] NavBar added for Opportunities / Players navigation
- [ ] Matching follows fallback chain: Gemini → Claude → Heuristic
- [ ] `run-matching` can chain after `run-analysis`

### Non-Functional Requirements

- [ ] Fallback mode: 5 sample Georgian players + heuristic matching + localStorage
- [ ] Mobile responsive: player roster, player detail, and all modals
- [ ] Dark theme consistent: all new components match scout-bg/scout-card/scout-accent
- [ ] New empty states for no-players, no-player-matches, no-opportunity-matches
- [ ] Matching pipeline handles 50 players × 200 opportunities without timeout
- [ ] Position normalization handles common abbreviations (RB, CB, GK, ST, etc.)
- [ ] Cantera importer is transport-agnostic (CSV now, REST API or Supabase later)
- [ ] No breaking changes to existing tag flow (free-text tagging still works)

## Dependencies & Prerequisites

**Completed (Phase 1-3):**
- `lib/supabase.js` — browser and server client helpers
- `lib/sample-data.js` — 12 sample clubs, POSITIONS, TARGET_LEAGUES
- `lib/fallback-analyzer.js` — heuristic gap analysis
- `lib/gemini-analyzer.js` — Gemini batch analysis (pattern to follow for matching)
- `lib/ai-analyzer.js` — Gemini → Claude fallback chain (pattern to follow)
- `supabase/migrations/001_initial_schema.sql` — clubs, opportunities, player_tags, pipeline_runs
- Full dashboard with filters, cards, tagging, My Matches tab

**New dependencies needed:**
- `csv-parse` npm package (for CSV import parsing) — lightweight, well-maintained
- No other new dependencies

**Blocked by (but can work around):**
- Cantera API details (TBD) — mitigated by starting with CSV import

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cantera API never materializes | Medium | Medium | CSV import works standalone. REST API is a pluggable upgrade. |
| Gemini matching costs escalate | Low | Medium | Heuristic narrows to top 10 before AI call. Cost is per-opportunity, not per-pair. |
| Position taxonomy mismatch (Cantera) | High | Medium | position-normalizer.js handles common variations. Unknown positions flagged for review. |
| Match scores feel inaccurate | Medium | High | Heuristic provides baseline. Gemini refines. Manual dismiss/confirm teaches Levan the system's accuracy. |
| Player data entered inconsistently | Medium | Low | Form validation, position select (not free text), stats as structured JSONB. |
| Too many match suggestions clutter cards | Low | Low | Top 3 by default, expandable. Dismissed suggestions hidden. |
| Migration of existing tags loses data | Low | High | Migration is additive (adds `player_id`, never removes `player_name`). Unmatched names logged. |
| Fallback mode matching quality is poor | Medium | Low | Heuristic matching is good enough for demos. Real value comes from Gemini in production. |

## Sources & References

### Internal References

- Player tag flow: `components/TagPlayerModal.js:1-171` — current free-text tagging
- Tag API: `app/api/tags/route.js:1-75` — POST/DELETE pattern to follow
- Gemini batch prompt: `lib/gemini-analyzer.js:68-74` — AI prompt structure to replicate
- Fallback chain: `lib/ai-analyzer.js:22-29` — Gemini → Claude → Heuristic pattern
- Pipeline pattern: `scripts/run-analysis.js:90-122` — batch processing and pipeline_runs logging
- Position enum: `lib/sample-data.js:833-844` — canonical POSITIONS array
- DB schema: `supabase/migrations/001_initial_schema.sql` — existing tables
- Dashboard component: `components/Dashboard.js` — state management pattern
- Opportunity card: `components/OpportunityCard.js` — card layout to extend
- BUILD.md Phase 2: lines 312-316 — player roster + matching engine
- BUILD.md Phase 4: lines 325-330 — Cantera integration
- Dashboard plan: `docs/plans/2026-03-15-feat-dashboard-frontend-plan.md` — completed, pattern reference
