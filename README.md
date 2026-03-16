# FFA Scout Board

AI-powered transfer opportunity radar for [Free Football Agency](https://freefootballagency.com). Scans European club squads weekly and identifies position gaps — which clubs need players, how urgently, and what they can pay.

## Quick Start

```bash
npm install
cp .env.local.example .env.local   # Then add your API keys
npm run dev                         # http://localhost:3000
```

## Environment Variables

| Variable | Required | Description | Fallback |
|----------|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL | Sample data mode |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key | Sample data mode |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key | Sample data mode |
| `GEMINI_API_KEY` | No | Gemini 2.5 Flash (primary AI) | Heuristic analysis |
| `ANTHROPIC_API_KEY` | No | Claude API (AI fallback) | Heuristic analysis |
| `API_FOOTBALL_KEY` | No | API-Football via RapidAPI | Sample data |

The app works with sample data when no keys are configured.

## Data Pipeline

Run these commands locally to populate your database:

```bash
# Fetch squad data from API-Football
npm run fetch-squads
npm run fetch-squads -- --league 144    # Single league
npm run fetch-squads -- --resume        # Resume from checkpoint

# Run AI analysis on squads
npm run run-analysis
npm run run-analysis -- --sample        # Sample data (no Supabase needed)

# Score players against opportunities
npm run run-matching
npm run run-matching -- --sample        # Sample data mode

# Import players from Cantera
npm run import-cantera -- --csv data/cantera-export.csv
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Add the environment variables above in the Vercel dashboard (Settings > Environment Variables)
4. Deploy

The database schema is in `supabase/migrations/`. Run these in the Supabase SQL editor before your first deploy.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **AI**: Gemini 2.5 Flash (primary) + Claude (fallback) + Heuristic (always available)
- **Data**: API-Football via RapidAPI
- **Database**: Supabase (PostgreSQL)
- **Hosting**: Vercel

## Target Leagues

Ligue 1 (France), Serie A & Serie B (Italy), Eredivisie (Netherlands), Pro League (Belgium), Super League (Switzerland), Ekstraklasa (Poland)

---

Built by Nino for Free Football Agency.
