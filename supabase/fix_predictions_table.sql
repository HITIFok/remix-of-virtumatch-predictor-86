-- ============================================
-- CORRECTION DE LA TABLE PREDICTIONS
-- ============================================

-- 1. Ajouter les colonnes manquantes
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS home TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS away TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS score_home INTEGER;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS score_away INTEGER;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS exact_score TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS winner_1x2 TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS gg_result TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS total_goals INTEGER;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS parity TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS over_under_15 TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS over_under_25 TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS over_under_35 TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS prob_gg DECIMAL(5,2);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS prob_gn DECIMAL(5,2);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS btts_prob DECIMAL(5,2);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS over25_prob DECIMAL(5,2);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS first_half_goal_prob DECIMAL(5,2);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS expected_goals DECIMAL(5,2);

-- 2. Supprimer les anciennes politiques RLS
DROP POLICY IF EXISTS "Public can read predictions" ON predictions;
DROP POLICY IF EXISTS "Public can read stats" ON prediction_stats;

-- 3. Créer les nouvelles politiques RLS
-- Lecture publique
CREATE POLICY "Public can read predictions" ON predictions
  FOR SELECT TO anon, authenticated
  USING (true);

-- Écriture pour tous (anon et authenticated)
CREATE POLICY "Public can insert predictions" ON predictions
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Mise à jour pour tous (pour la vérification)
CREATE POLICY "Public can update predictions" ON predictions
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Pour prediction_stats
CREATE POLICY "Public can read stats" ON prediction_stats
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Service can manage stats" ON prediction_stats
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Supprimer la contrainte unique problématique
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_match_id_created_at_key;

-- 5. Créer un index sur device_id
CREATE INDEX IF NOT EXISTS idx_predictions_device ON predictions(device_id);

-- 6. Vérifier que RLS est activé
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_stats ENABLE ROW LEVEL SECURITY;
