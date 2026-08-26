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

-- 2. Supprimer la contrainte unique existante si elle pose problème
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_match_id_created_at_key;

-- 3. Créer un nouvel index unique plus flexible
CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_unique_match_day
ON predictions (match_id, created_at::date)
WHERE match_id IS NOT NULL;

-- 4. Ajouter les politiques RLS pour l'insertion et la mise à jour

-- Permettre l'insertion publique (pour les prédictions des utilisateurs)
DROP POLICY IF EXISTS "Public can insert predictions" ON predictions;
CREATE POLICY "Public can insert predictions" ON predictions
  FOR INSERT
  WITH CHECK (true);

-- Permettre la mise à jour publique (pour la vérification des résultats)
DROP POLICY IF EXISTS "Public can update predictions" ON predictions;
CREATE POLICY "Public can update predictions" ON predictions
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 5. S'assurer que RLS est activé
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

-- 6. Vérifier les politiques existantes
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'predictions';

-- 7. Message de confirmation
DO $$
BEGIN
    RAISE NOTICE '✅ Table predictions corrigée avec succès !';
    RAISE NOTICE '   - Colonnes manquantes ajoutées';
    RAISE NOTICE '   - Politiques RLS configurées';
    RAISE NOTICE '   - Index unique recréé';
END $$;
