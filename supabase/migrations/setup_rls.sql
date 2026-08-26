-- Enable RLS on scraped_data table
ALTER TABLE scraped_data ENABLE ROW LEVEL SECURITY;

-- Policy to allow public read access (for anon key)
CREATE POLICY "Allow public read on scraped_data"
ON scraped_data
FOR SELECT
TO anon, authenticated
USING (true);

-- Policy to allow service role to insert (for Edge Functions)
CREATE POLICY "Allow service role insert on scraped_data"
ON scraped_data
FOR INSERT
TO service_role
WITH CHECK (true);

-- Policy to allow service role to delete (for cleanup)
CREATE POLICY "Allow service role delete on scraped_data"
ON scraped_data
FOR DELETE
TO service_role
USING (true);
