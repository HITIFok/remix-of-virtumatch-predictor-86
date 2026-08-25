-- Migration 005: Add user_id to predictions
-- Allows querying predictions by user (magic link auth) instead of only by device_id

ALTER TABLE predictions ADD COLUMN IF NOT EXISTS user_id TEXT;

-- Index for fast user-based lookups
CREATE INDEX IF NOT EXISTS idx_predictions_user_id ON predictions(user_id);

-- Composite index: common query pattern (user_id + status)
CREATE INDEX IF NOT EXISTS idx_predictions_user_status ON predictions(user_id, status);
