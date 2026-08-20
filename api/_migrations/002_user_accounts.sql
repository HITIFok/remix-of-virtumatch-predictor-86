-- User accounts + magic links for email-based premium authentication
-- Replaces device_id as the premium tracking mechanism.
-- Run this migration on the Neon database before deploying Phase 2+.

-- ═══════════════════════════════════════════════════════════════════
-- 1. users table
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

COMMENT ON TABLE users IS 'User accounts identified by email — created on first magic link verification';

-- ═══════════════════════════════════════════════════════════════════
-- 2. magic_links table
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS magic_links (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  token_hash  TEXT NOT NULL,
  email       TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('activate', 'login')),
  payload     JSONB,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by token_hash (the only query pattern)
CREATE INDEX IF NOT EXISTS magic_links_token_hash_idx ON magic_links (token_hash);

-- Cleanup expired links (for future cron)
CREATE INDEX IF NOT EXISTS magic_links_expires_at_idx ON magic_links (expires_at);

COMMENT ON TABLE magic_links IS 'One-time magic link tokens — token is NEVER stored in cleartext, only its SHA-256 hash';
COMMENT ON COLUMN magic_links.token_hash IS 'SHA-256 hash of the plaintext token sent via email';
COMMENT ON COLUMN magic_links.payload IS 'For purpose=activate: { code, durationDays } pending activation data';

-- ═══════════════════════════════════════════════════════════════════
-- 3. ALTER premium_activations — add user_id (nullable during transition)
-- ═══════════════════════════════════════════════════════════════════

-- Add user_id column (nullable — existing rows keep their device_id only)
ALTER TABLE premium_activations
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

-- During transition, a premium can be identified by EITHER device_id OR user_id.
-- The existing ON CONFLICT (device_id) constraint remains unchanged.
-- New user-based activations will use a separate uniqueness path
-- (enforced in application code + Phase 5 migration).
