-- FFA Scout Board — Initial Schema
-- Run this in Supabase SQL Editor to set up the database

-- Clubs we're monitoring
CREATE TABLE clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_football_id INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  league TEXT NOT NULL,
  country TEXT NOT NULL,
  logo_url TEXT,
  budget_tier TEXT DEFAULT 'mid' CHECK (budget_tier IN ('low', 'mid', 'high')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw squad data (refreshed weekly)
CREATE TABLE squad_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  squad_data JSONB NOT NULL,
  player_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(club_id, snapshot_date)
);

-- AI-generated opportunity analysis
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
  snapshot_id UUID REFERENCES squad_snapshots(id) ON DELETE SET NULL,
  position TEXT NOT NULL,
  urgency INTEGER NOT NULL CHECK (urgency BETWEEN 1 AND 3),
  budget_tier TEXT NOT NULL CHECK (budget_tier IN ('low', 'mid', 'high')),
  reason TEXT NOT NULL,
  ideal_profile TEXT,
  transfer_window TEXT,
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- Levan's player-opportunity matches
CREATE TABLE player_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  notes TEXT,
  tagged_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(opportunity_id, player_name)
);

-- Pipeline execution log
CREATE TABLE pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL CHECK (run_type IN ('fetch', 'analyze')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  leagues_processed TEXT[],
  clubs_processed INTEGER DEFAULT 0,
  clubs_failed INTEGER DEFAULT 0,
  error_log JSONB,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX idx_opportunities_active ON opportunities(is_active, club_id);
CREATE INDEX idx_opportunities_club ON opportunities(club_id);
CREATE INDEX idx_squad_snapshots_club_date ON squad_snapshots(club_id, snapshot_date DESC);
CREATE INDEX idx_pipeline_runs_type_status ON pipeline_runs(run_type, status);
