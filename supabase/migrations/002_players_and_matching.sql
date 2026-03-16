-- FFA Scout Board — Players, Matching, and Cantera Integration
-- Run this in Supabase SQL Editor after 001_initial_schema.sql

-- Structured player profiles (Levan's roster + Cantera imports)
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  age INTEGER,
  primary_position TEXT NOT NULL,
  secondary_position TEXT,
  nationality TEXT DEFAULT 'Georgia',
  current_club TEXT,
  contract_status TEXT CHECK (contract_status IN ('free_agent', 'under_contract', 'loan', 'expiring')),
  contract_until DATE,
  stats JSONB DEFAULT '{}',
  video_links TEXT[] DEFAULT '{}',
  scouting_notes TEXT,
  photo_url TEXT,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'cantera', 'csv_import')),
  cantera_id TEXT UNIQUE,
  cantera_active BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI-generated match results
CREATE TABLE player_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  match_score INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  match_reasoning TEXT,
  source TEXT DEFAULT 'heuristic' CHECK (source IN ('heuristic', 'gemini', 'claude')),
  is_confirmed BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
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

-- Indexes for players
CREATE INDEX idx_players_position ON players(primary_position);
CREATE INDEX idx_players_nationality ON players(nationality);
CREATE INDEX idx_players_cantera_id ON players(cantera_id) WHERE cantera_id IS NOT NULL;
CREATE INDEX idx_players_active ON players(is_active) WHERE is_active = TRUE;

-- Indexes for player_matches
CREATE INDEX idx_player_matches_opportunity ON player_matches(opportunity_id);
CREATE INDEX idx_player_matches_player ON player_matches(player_id);
CREATE INDEX idx_player_matches_score ON player_matches(match_score DESC);

-- Index for player_tags.player_id
CREATE INDEX idx_player_tags_player_id ON player_tags(player_id) WHERE player_id IS NOT NULL;
