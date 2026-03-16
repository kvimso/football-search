# FFA Scout Board — MVP Build Plan (with Supabase)

# Claude API + API-Football + Supabase. Real data. Persistent. Deployable.

---

## Your Setup Checklist (do this first)

### 1. API-Football ✅ (already done)

Key: fd17cb01a311d611a51cd58dc7d1ea92

### 2. Supabase (5 minutes)

- Go to https://supabase.com → New Project → name it "ffa-scout-board"
- Set database password, wait for spin-up
- Settings → API → copy Project URL + anon key + service_role key

### 3. Your .env.local

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-your-existing-key
API_FOOTBALL_KEY=fd17cb01a311d611a51cd58dc7d1ea92
```

### 4. Open Claude Code in your project folder

---

## Session 1: Real Data Pipeline

```
Read CLAUDE.md for full context. The prototype currently uses sample data from lib/sample-data.js. We need to switch to real data from API-Football.

Build the data fetching pipeline:

1. Update lib/api-football.js:
   - fetchTeamsByLeague(leagueId, season) — GET /teams?league={id}&season=2025
     Returns array of { id, name, logo }
   - fetchSquad(teamId) — GET /players/squads?team={id}
     Returns array of { name, age, number, position, photo }
   - fetchInjuries(leagueId, season) — GET /injuries?league={id}&season=2025
     Returns current injuries with type and expected return
   - All requests use header: x-apisports-key from env API_FOOTBALL_KEY
   - Add rate limiting: max 10 requests per minute with delay between calls
   - If API_FOOTBALL_KEY is missing, return null (fallback to sample data)

2. Create lib/data-pipeline.js:
   - fetchAllLeagues() — fetches team lists for these 5 leagues:
     Ligue 1 (61), Pro League (144), Eredivisie (88), Super League (179), Ekstraklasa (106)
   - fetchAllSquads(teams) — fetches squad for each team sequentially
     with 1 second delay between calls to respect rate limits
   - mergeInjuryData(squads, injuries) — adds injury info to squad players
   - buildClubObjects(teams, squads) — transforms API-Football format into
     our club format that the AI analyzer expects:
     { club_id, name, league, country, logo, squad: [{ name, age, position, sub_position, injured, injury_type }] }

3. Create app/api/fetch-data/route.js — POST endpoint that:
   - Runs the full pipeline (fetch leagues → teams → squads → injuries)
   - Returns the transformed club objects array
   - Logs progress: "Fetching league 1/5... Fetching squad 3/18..."

Important: API-Football positions come as "Goalkeeper", "Defender", "Midfielder", "Attacker".
We need sub_positions for accurate analysis. Map them from the player's detailed position
if available, or leave as the general position. The AI analyzer handles both.

Test: call POST /api/fetch-data and verify it returns real club data.
```

---

## Session 2: Supabase Storage

```
Read CLAUDE.md. We're adding Supabase for persistent storage so data survives
Vercel deploys and page refreshes. Single-user app, no RLS needed.

1. Install Supabase: npm install @supabase/supabase-js

2. Create lib/supabase.js:
   - Server client using SUPABASE_SERVICE_ROLE_KEY (for API routes)
   - Uses NEXT_PUBLIC_SUPABASE_URL

3. Create the database tables. Generate a migration file or give me the SQL to run
   in the Supabase SQL editor. Three tables:

   clubs_cache:
   - id serial primary key
   - club_api_id integer unique (API-Football team ID)
   - name text
   - league text
   - country text
   - logo_url text
   - squad_data jsonb (full squad array from API-Football)
   - fetched_at timestamptz default now()

   opportunities:
   - id uuid primary key default gen_random_uuid()
   - club_api_id integer references clubs_cache(club_api_id)
   - club_name text
   - league text
   - country text
   - logo_url text
   - position text
   - urgency integer check (urgency between 1 and 3)
   - budget_tier text check (budget_tier in ('low', 'mid', 'high'))
   - reason text
   - ideal_profile text
   - analyzed_at timestamptz default now()

   player_tags:
   - id uuid primary key default gen_random_uuid()
   - opportunity_id uuid references opportunities(id) on delete cascade
   - player_name text not null
   - notes text
   - tagged_at timestamptz default now()

4. Create lib/cache.js that uses Supabase instead of JSON files:
   - saveSquadsToCache(clubs) — upserts into clubs_cache
   - loadSquadsFromCache(maxAgeHours) — select from clubs_cache where fetched_at > now() - interval
   - saveAnalysisResults(results) — delete old opportunities, insert new ones
   - loadAnalysisResults(maxAgeHours) — select from opportunities where analyzed_at > now() - interval
   - getCacheStatus() — returns { squads_cached_at, analysis_cached_at }

5. Update app/api/analyze/route.js:
   - Check Supabase for cached analysis (< 168 hours old)
   - If fresh, return cached results
   - If stale, fetch squads → analyze → save to Supabase → return
   - Support force=true to skip cache

6. Create app/api/tags/route.js:
   - GET — select all from player_tags joined with opportunities
   - POST — insert into player_tags { opportunity_id, player_name, notes }
   - DELETE — delete from player_tags where id = ?

7. Create app/api/cache-status/route.js:
   - GET — returns cache ages from Supabase

No RLS policies needed — this is a single-user app using service_role key.
Data persists on Vercel, Levan never loses his tags or cached analysis.
```

---

## Session 3: Tags UI + My Pipeline

```
Read CLAUDE.md. Tags are now stored in Supabase via the /api/tags endpoints
built in the previous session. Now wire up the frontend.

1. Update page.js to fetch tags on page load:
   - GET /api/tags on mount → populate tags state
   - Match tags to opportunities by opportunity_id

2. Update OpportunityCard.js:
   - "Tag Player" button opens TagModal
   - If already tagged, show player name with green checkmark badge
   - "Remove Tag" option on tagged cards

3. Update TagModal.js:
   - On save: POST /api/tags with { opportunity_id, player_name, notes }
   - On success: update local state + close modal
   - Loading state on save button

4. Add "My Pipeline" tab:
   - Tab bar at top: "All Opportunities" | "My Pipeline"
   - My Pipeline shows ONLY tagged opportunities
   - Each card shows: club, position, urgency, tagged player name, notes, date tagged
   - Sorted by most recently tagged
   - Empty state: "No players tagged yet. Browse opportunities and tag your players."
   - This is Levan's active deal pipeline

5. Add tag count to stats panel:
   - "X players tagged" stat card

Test: tag a player → refresh page → tag persists.
Switch to My Pipeline → tagged opportunity shows up.
```

---

## Session 4: Dashboard Polish

```
Read CLAUDE.md. Final polish to make this daily-use ready.

1. Header improvements:
   - Show cache status: "Last refreshed: 2 days ago" or "Never refreshed"
   - "Refresh Data" button that triggers full pipeline (fetch + analyze)
   - While refreshing, show progress: "Fetching squads..." then "Analyzing..."
   - Disable the button while refresh is in progress
   - Show badges: "AI-Powered" or "Heuristic Mode", "Live Data" or "Sample Data"

2. Loading and empty states:
   - First visit (no cache): welcome screen with "Run First Analysis" button
   - While analyzing: skeleton loader cards with pulse animation
   - Error state: red banner with error message and "Try Again" button

3. Opportunity cards improvements:
   - Sort by urgency (critical first), then alphabetical
   - Club logo image (from API-Football URL) with fallback initial
   - Stagger card entrance animations (50ms delay between each)

4. Stats panel:
   - Total opportunities / Critical count / Clubs analyzed / Top needed position
   - Calculate from current filtered results

5. Responsive design:
   - Cards: 3 columns desktop, 2 tablet, 1 mobile
   - Filter bar: horizontal desktop, stacked mobile
   - Stats panel: row desktop, 2x2 grid mobile

6. Footer: "FFA Scout Board v0.1 — Built for Free Football Agency"

Test full flow: run analysis → filter → tag player → My Pipeline →
refresh page → everything persists. Test mobile viewport.
```

---

## Session 5: Deploy Prep

```
Read CLAUDE.md. Prepare for Vercel deployment. Storage is handled by Supabase
so no filesystem workarounds needed.

1. Environment variable validation on startup:
   - Check NEXT_PUBLIC_SUPABASE_URL exists
   - Check SUPABASE_SERVICE_ROLE_KEY exists
   - Check API_FOOTBALL_KEY (optional — log "using sample data" if missing)
   - Check ANTHROPIC_API_KEY (optional — log "heuristic mode" if missing)
   - Log clear status messages for each

2. Error handling:
   - API-Football rate limit → "Daily API limit reached, showing cached data"
   - Claude API timeout → retry once, then show error
   - Supabase connection failure → clear error message
   - Always show cached data if available, even if new fetch fails

3. Add .gitignore: node_modules/, .next/, .env.local

4. Create README.md:
   - "FFA Scout Board — AI-powered transfer opportunity radar"
   - Setup instructions
   - Built by Nino for Free Football Agency

5. Run npm run build — fix any errors

Ready to push to GitHub and deploy on Vercel with env vars.
```

---

## Order of operations

```
You:  Create Supabase project → copy keys → update .env.local   (5 min)
CC#1: Real data pipeline                                         (15 min)
You:  Run the SQL from Session 2 in Supabase SQL editor          (2 min)
CC#2: Supabase storage + cache + tags API                        (15 min)
CC#3: Tags UI + My Pipeline tab                                  (10 min)
CC#4: Dashboard polish                                           (15 min)
CC#5: Deploy prep                                                (10 min)
You:  GitHub → Vercel (add env vars) → share URL with Levan      (10 min)
```

Total: ~1.5 hours Claude Code + 20 minutes your time

---

## What's NOT in this MVP

- Gemini swap (later, for cheaper batch processing)
- Cantera integration
- User auth / login
- PDF scouting reports
- Player-club AI matching
- Automatic weekly cron
- More than 5 leagues
