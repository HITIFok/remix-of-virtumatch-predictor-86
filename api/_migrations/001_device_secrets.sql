-- Device Secrets table for HMAC device token auth
-- Run this migration on the Neon database before deploying the auth changes

CREATE TABLE IF NOT EXISTS device_secrets (
  device_id TEXT PRIMARY KEY,
  device_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups (primary key already creates one, this is for documentation)
COMMENT ON TABLE device_secrets IS 'Per-device HMAC secrets for device token authentication';
COMMENT ON COLUMN device_secrets.device_secret IS 'NEVER expose this in logs or API responses (except registration)';
