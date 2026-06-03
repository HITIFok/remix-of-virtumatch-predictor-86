-- Fix RLS policies for access_codes table — SECURITY AUDIT 2026-06-02
-- ⚠️ CRITICAL: Previous policy "FOR ALL USING (true)" was too permissive

-- Enable RLS
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;

-- Remove permissive policies
DROP POLICY IF EXISTS "Allow all access" ON access_codes;
DROP POLICY IF EXISTS "Allow read access" ON access_codes;
DROP POLICY IF EXISTS "Allow write access" ON access_codes;
DROP POLICY IF EXISTS "Allow insert access" ON access_codes;
DROP POLICY IF EXISTS "Allow delete access" ON access_codes;
DROP POLICY IF EXISTS "Allow all operations on access_codes" ON access_codes;

-- SELECT: public (needed for code validation)
CREATE POLICY "Public read access_codes" ON access_codes
  FOR SELECT USING (true);

-- UPDATE: only unused codes can be activated (prevents replay)
CREATE POLICY "Update unused codes only" ON access_codes
  FOR UPDATE USING (used = false)
  WITH CHECK (used = false);

-- INSERT/DELETE: service_role only (admin operations)
CREATE POLICY "Service role access_codes" ON access_codes
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
