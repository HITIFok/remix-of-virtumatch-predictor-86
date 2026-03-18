-- Fix RLS policies for access_codes table to allow delete operations

-- First, check if RLS is enabled and drop existing policies if any
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (ignore errors if they don't)
DROP POLICY IF EXISTS "Allow all access" ON access_codes;
DROP POLICY IF EXISTS "Allow read access" ON access_codes;
DROP POLICY IF EXISTS "Allow write access" ON access_codes;
DROP POLICY IF EXISTS "Allow insert access" ON access_codes;
DROP POLICY IF EXISTS "Allow delete access" ON access_codes;

-- Create comprehensive policy for all operations
CREATE POLICY "Allow all operations on access_codes" ON access_codes
  FOR ALL USING (true) WITH CHECK (true);
