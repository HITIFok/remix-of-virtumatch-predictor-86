-- Phase 5: Add 'migrate' purpose to magic_links CHECK constraint
-- Allows existing device_id premium users to self-migrate to email-based accounts.
-- Run this ONCE on Neon SQL Editor.

ALTER TABLE magic_links DROP CONSTRAINT magic_links_purpose_check;
ALTER TABLE magic_links ADD CONSTRAINT magic_links_purpose_check
  CHECK (purpose IN ('activate', 'login', 'migrate'));
