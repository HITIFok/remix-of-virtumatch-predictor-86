-- FIX-15: Missing Database Indexes (DB-04)
-- Based on SECURITY_REMEDIATION_PLAN.md
-- Run with: psql $NEON_DATABASE_URL -f sql/006_add_missing_indexes.sql

-- Predictions table indexes (most queried)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_predictions_device_id ON predictions(device_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_predictions_status ON predictions(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_predictions_user_id ON predictions(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_predictions_status_created_at ON predictions(status, created_at);

-- Premium activations indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_premium_activations_user_id ON premium_activations(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_premium_activations_device_id ON premium_activations(device_id);

-- Access codes index (lookup by code)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_access_codes_code ON access_codes(code);

-- Scraped data composite index (DELETE+INSERT in push-odds)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scraped_data_type_league ON scraped_data(data_type, league);

-- Magic links index (verify lookup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_magic_links_email ON magic_links(email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_magic_links_token_hash ON magic_links(token_hash);

-- Device secrets index (auth lookup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_secrets_device_id ON device_secrets(device_id);
