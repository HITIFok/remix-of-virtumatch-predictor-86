
CREATE TABLE public.scraped_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_type text NOT NULL,
  league text DEFAULT '',
  payload jsonb NOT NULL DEFAULT '[]'::jsonb,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scraped_data_type_league ON public.scraped_data(data_type, league);
CREATE INDEX idx_scraped_data_scraped_at ON public.scraped_data(scraped_at DESC);

ALTER TABLE public.scraped_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.scraped_data FOR SELECT USING (true);
CREATE POLICY "Service role insert" ON public.scraped_data FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role update" ON public.scraped_data FOR UPDATE USING (true);
CREATE POLICY "Service role delete" ON public.scraped_data FOR DELETE USING (true);
