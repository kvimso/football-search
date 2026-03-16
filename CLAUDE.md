# FFA Scout Board — CLAUDE.md

## What is this?

An AI-powered dashboard for Free Football Agency (Levan Seturidze, CEO). It scans European club squads weekly and identifies transfer opportunities — which clubs need players at which positions, how urgently, and what they can pay. Levan opens this daily to find placement opportunities for his Georgian players.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **AI Analysis**: Gemini 2.5 Flash (bulk analysis) + Claude API (fallback/Phase 2 reports)
- **Football Data**: API-Football via RapidAPI (free tier: 100 req/day)
- **Database**: Supabase (PostgreSQL) — schema in `supabase/migrations/001_initial_schema.sql` + `002_players_and_matching.sql`
- **Hosting**: Vercel (deploy-ready). Runs locally with `npm run dev`.

## Git

Do NOT initialize git or create commits unless explicitly asked. No git operations.

## Environment Variables (.env.local)

```
ANTHROPIC_API_KEY=sk-ant-...        # AI analysis (Claude fallback)
GEMINI_API_KEY=...                   # AI analysis (primary — Gemini 2.5 Flash)
API_FOOTBALL_KEY=...                 # Football data (RapidAPI)
NEXT_PUBLIC_SUPABASE_URL=...         # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=...    # Supabase anon key (public, read-only via RLS)
SUPABASE_SERVICE_ROLE_KEY=...        # Supabase service role key (server-side only)
# CANTERA_API_URL=...               # Cantera REST API (optional, for future integration)
# CANTERA_API_KEY=...               # Cantera API key (optional)
```

App works with sample data when no keys are configured.

## Project Structure

```
ffa-scout-board/
├── app/
│   ├── layout.js                    # Root layout, dark theme, NavBar
│   ├── page.js                      # Dashboard page (opportunities + matches + players)
│   ├── globals.css                  # Tailwind + custom dark theme
│   ├── players/
│   │   ├── page.js                  # Player roster page (Server Component)
│   │   └── [id]/
│   │       └── page.js              # Player detail page (Server Component)
│   └── api/
│       ├── analyze/
│       │   └── route.js             # POST — trigger AI analysis (168h cache, force param, concurrent guard)
│       ├── players/
│       │   ├── route.js             # GET/POST — list/create players
│       │   └── [id]/
│       │       └── route.js         # GET/PUT/DELETE — single player CRUD
│       ├── cache-status/
│       │   └── route.js             # GET — squad + analysis freshness timestamps
│       ├── matches/
│       │   └── route.js             # GET/POST — match suggestions, confirm/dismiss
│       └── tags/
│           └── route.js             # GET/POST/DELETE — player tags
├── components/
│   ├── Dashboard.js                 # Main dashboard with opportunities + match integration
│   ├── FilterBar.js                 # Filter controls for opportunities
│   ├── OpportunityCard.js           # Opportunity card with tags + match suggestions
│   ├── TagPlayerModal.js            # Tag player modal with roster picker
│   ├── MatchSuggestions.js          # AI match suggestion chips on opportunity cards
│   ├── StatsPanel.js                # Stats overview (opportunities, critical, tagged, clubs)
│   ├── EmptyState.js                # Empty state messages for various views
│   ├── NavBar.js                    # Top-level navigation (Opportunities | Players)
│   ├── PlayerRoster.js              # Player card grid with search/filter
│   ├── PlayerCard.js                # Individual player card
│   ├── PlayerDetail.js              # Full player profile with matches
│   └── AddPlayerModal.js            # Add/edit player form
├── lib/
│   ├── sample-data.js               # 12 real clubs, 7 target leagues, POSITIONS enum
│   ├── sample-players.js            # 5 sample Georgian players for demo mode
│   ├── api-football.js              # API-Football integration with rate limiting
│   ├── ai-analyzer.js               # Unified analyzer: Gemini → Claude → Heuristic
│   ├── gemini-analyzer.js           # Gemini 2.5 Flash batch analysis (25 clubs/batch)
│   ├── fallback-analyzer.js         # Heuristic fallback (no API key needed)
│   ├── env-check.js                 # Centralized env var validation (logs status on cold start)
│   ├── supabase.js                  # Supabase client helpers (server + browser)
│   ├── data-pipeline.js             # Core fetch pipeline (reusable from scripts or API routes)
│   ├── analysis-pipeline.js         # Core analysis helpers (loadClubsWithSnapshots, storeOpportunities)
│   ├── pipeline-logger.js           # Shared pipeline run logging (Supabase pipeline_runs)
│   ├── team-cache.js                # Team list cache (data/league-teams.json) to save API requests
│   ├── match-engine.js              # Heuristic player-opportunity scoring (0-100)
│   ├── match-ai-refiner.js          # Gemini/Claude AI refinement for top matches
│   ├── position-normalizer.js       # Position string normalization (abbreviations → canonical)
│   └── importers/
│       ├── csv-parser.js            # Generic CSV to player array parser
│       └── cantera.js               # Cantera importer (CSV/API/Supabase) + upsert logic
├── scripts/
│   ├── fetch-squads.js              # Fetch squad data from API-Football → Supabase
│   ├── run-analysis.js              # Run Gemini analysis pipeline → opportunities
│   ├── verify-analysis.js           # Display analysis for manual accuracy review
│   ├── run-matching.js              # Run player-opportunity matching pipeline
│   ├── import-cantera.js            # Import players from Cantera (CSV/API)
│   └── migrate-tags.js              # Migrate free-text tags to structured player references
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql   # Base schema (clubs, opportunities, player_tags, pipeline_runs)
│       └── 002_players_and_matching.sql # Players, player_matches, player_tags FK
├── data/                            # Runtime data (checkpoints, cache — gitignored)
├── docs/
│   └── plans/                       # Implementation plans
├── .env.local.example
├── package.json
└── CLAUDE.md
```

## AI Analysis Fallback Chain

1. **Gemini 2.5 Flash** (primary) — batch analysis, 25 clubs per request
2. **Claude API** (fallback) — per-club analysis if Gemini fails
3. **Heuristic** (always available) — rule-based analysis, no API key needed

## Core Data Flow

1. `scripts/fetch-squads.js` pulls squad data from API-Football → stores in Supabase
2. `scripts/run-analysis.js` loads squads, sends to Gemini in batches → stores opportunities
3. `scripts/run-matching.js` scores players against opportunities (heuristic → AI refinement) → stores matches
4. Frontend reads opportunities + matches + players from Supabase and displays as filterable cards
5. Levan filters by league/position/urgency/budget, reviews AI match suggestions, and tags players
6. `scripts/import-cantera.js` imports academy players from Cantera (CSV now, REST API later)

## AI Analysis Prompt (core logic)

Returns structured JSON per club:

```json
[
  {
    "position": "Right-Back",
    "urgency": 3,
    "reason": "Only 1 RB in squad (Dennis Appiah, age 33), injured with ACL until June. No backup.",
    "budget_tier": "mid",
    "ideal_profile": "Young (20-25) attacking right-back ready to start"
  }
]
```

Urgency scoring:

- 3 (CRITICAL): Only 1 player at position, OR starter 33+, OR key player injured 3+ months
- 2 (MEDIUM): 2 players but one aging (31+) or thin depth
- 1 (LOW): Adequate depth but could upgrade

## Target Leagues (7 leagues across 6 countries)

| League | Country | API-Football ID |
|--------|---------|----------------|
| Ligue 1 | France | 61 |
| Serie A | Italy | 135 |
| Serie B | Italy | 136 |
| Eredivisie | Netherlands | 88 |
| Pro League | Belgium | 144 |
| Super League | Switzerland | 207 |
| Ekstraklasa | Poland | 106 |

## Sample Data (12 clubs across 5 leagues)

Pre-loaded realistic squad data for demo without API key:

- France (Ligue 1): FC Nantes, RC Lens, Saint-Etienne
- Belgium (Pro League): RSC Anderlecht, Club Brugge, KRC Genk
- Switzerland (Super League): FC Basel, Young Boys
- Poland (Ekstraklasa): Lech Poznan, Legia Warsaw
- Netherlands (Eredivisie): FC Twente, FC Utrecht

## Design Spec

- Dark theme (football scout aesthetic — dark greens and blacks)
- Background: #0a0f0d, Cards: #111916, Accent: #22c55e (green)
- Urgency badges: Red (critical), Amber (medium), Blue (low)
- Budget badges: Green (high), Amber (mid), Blue (low)
- Cards animate in with slide-up on load
- Mobile-responsive (Levan might demo on phone)

## Scripts

```bash
npm install
cp .env.local.example .env.local     # Then add your API keys
npm run dev                           # Runs on localhost:3000

# Data pipeline
npm run fetch-squads                  # Fetch squads from API-Football → Supabase
npm run fetch-squads -- --league 144  # Fetch single league (Belgian Pro League)
npm run fetch-squads -- --resume      # Resume from checkpoint (free tier: 100 req/day)
npm run run-analysis                  # Run Gemini analysis on all clubs
npm run run-analysis -- --sample      # Run analysis on sample data (no Supabase needed)
npm run verify-analysis               # Display analysis for manual review
npm run verify-analysis -- --sample   # Verify with sample data

# Player matching
npm run run-matching                  # Score all players against all opportunities
npm run run-matching -- --sample      # Match with sample data (no Supabase needed)
npm run run-matching -- --player <id> # Match a single player against all opportunities
npm run run-matching -- --opportunity <id> # Match all players against a single opportunity

# Cantera integration
npm run import-cantera -- --csv data/cantera-export.csv  # Import from CSV file
npm run import-cantera -- --api       # Import from Cantera REST API (when configured)

# Migration
npm run migrate-tags                  # Link existing free-text tags to player records
```

## Player Matching Engine

Hybrid scoring approach:
1. **Heuristic** (`lib/match-engine.js`): position match (40pts) + age fit (20pts) + league compatibility (15pts) + contract bonus (5pts) + secondary position (25pts)
2. **AI Refinement** (`lib/match-ai-refiner.js`): Gemini/Claude refines top 10 candidates per opportunity with reasoning text
3. Results stored in `player_matches` table, displayed as suggestions on opportunity cards

Match score badges: Green (80+), Amber (50-79), Blue (<50) — same pattern as urgency/budget badges.

## Cantera Integration

Transport-agnostic importer (`lib/importers/cantera.js`):
- **CSV import** (active): `npm run import-cantera -- --csv <path>`
- **REST API** (placeholder): for when Cantera API details are finalized
- **Shared Supabase** (placeholder): for direct DB integration
- Field-level ownership: Cantera owns stats/position/age; FFA owns scouting notes/video/contract status

## Known Limitations

- **Sub-positions**: API-Football `/players/squads` returns only broad positions (Goalkeeper/Defender/Midfielder/Attacker). Gemini analysis handles this acceptably via player knowledge. Heuristic fallback and match engine degrade without sub-positions.
- **Injury data**: Opt-in via `--with-injuries` flag on fetch-squads. Doubles API requests (+1 per team). Not enabled by default to preserve free tier budget (100 req/day).
- **Team cache**: `data/league-teams.json` saves 7 API requests per run. Invalidates automatically on season change or after 30 days.
- **API budget**: 131 teams across 7 leagues requires 2 days to fetch all squads on free tier (100 req/day). Use `--resume` to continue across days.

## What NOT to build (MVP scope)

- No user auth
- No real-time data (weekly refresh is fine)
- No PDF report generation (Phase 3)
