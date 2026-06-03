-- Migration: Fix scraped_data schema for reliable verification
-- Adds league_id column, unique constraint, and match_id storage
-- Run this in Supabase SQL Editor

-- 1. Add league_id column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_data' AND column_name = 'league_id'
  ) THEN
    ALTER TABLE public.scraped_data ADD COLUMN league_id TEXT DEFAULT '';
  END IF;
END $$;

-- 2. Backfill league_id from existing league names
UPDATE public.scraped_data
SET league_id = CASE league
  WHEN 'English League' THEN '8035'
  WHEN 'Coupe d''Afrique' THEN '8060'
  WHEN 'Champions League' THEN '8056'
  WHEN 'Italian League' THEN '8036'
  WHEN 'Spanish League' THEN '8037'
  WHEN 'French League' THEN '8042'
  WHEN 'German League' THEN '8043'
  WHEN 'Portuguese League' THEN '8044'
  WHEN 'Coupe du monde' THEN '8065'
  ELSE ''
END
WHERE league_id = '' OR league_id IS NULL;

-- 3. Drop old index if exists and create unique constraint
DROP INDEX IF EXISTS idx_scraped_data_type_league;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scraped_data_unique
  ON public.scraped_data(data_type, league_id);

-- 4. Update the scraped_at index to include data_type
DROP INDEX IF EXISTS idx_scraped_data_scraped_at;
CREATE INDEX idx_scraped_data_scraped_at ON public.scraped_data(scraped_at DESC);

-- 5. Add RLS policy for UPDATE (needed for upsert/merge)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scraped_data' AND policyname = 'Service role update'
  ) THEN
    CREATE POLICY "Service role update" ON public.scraped_data FOR UPDATE WITH CHECK (true);
  END IF;
END $$;

-- 6. Clean up duplicate rows (keep most recent per data_type + league_id)
DELETE FROM public.scraped_data a
USING public.scraped_data b
WHERE a.data_type = b.data_type
  AND a.league_id = b.league_id
  AND a.id < b.id;
