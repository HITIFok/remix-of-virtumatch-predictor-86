-- Add round + league_id columns for round-aware verification
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS round INTEGER;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS league_id TEXT;

-- Index for faster round-based lookups
CREATE INDEX IF NOT EXISTS idx_predictions_round ON predictions(round);
CREATE INDEX IF NOT EXISTS idx_predictions_league_round ON predictions(league_id, round);
