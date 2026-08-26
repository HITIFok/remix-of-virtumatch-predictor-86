-- Créer la table scraped_data dans Neon
-- Stocke les données scrapées (matches, results, ranking) par type et ligue

CREATE TABLE IF NOT EXISTS scraped_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_type TEXT NOT NULL,
  league TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (data_type, league)
);

-- Index pour les requêtes rapides
CREATE INDEX IF NOT EXISTS idx_scraped_data_type_league ON scraped_data (data_type, league);

-- Autoriser l'accès public en lecture (les données scrapées sont publiques)
ALTER TABLE scraped_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read scraped_data" ON scraped_data
  FOR SELECT USING (true);

-- Écriture : uniquement via service_role ou la Vercel API (qui utilise NEON_DATABASE_URL direct)
CREATE POLICY "Service role scraped_data" ON scraped_data
  FOR ALL USING (true);
