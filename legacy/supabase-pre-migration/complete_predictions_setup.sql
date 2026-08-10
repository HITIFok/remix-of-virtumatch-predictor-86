-- ============================================
-- SCRIPT COMPLET POUR LA TABLE PREDICTIONS
-- À exécuter dans Supabase SQL Editor
-- ============================================

-- 1. Supprimer la table si elle existe et la recréer
DROP TABLE IF EXISTS predictions CASCADE;

-- 2. Créer la table predictions avec toutes les colonnes
CREATE TABLE predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Infos du match
  match_id BIGINT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home TEXT,
  away TEXT,
  league TEXT DEFAULT 'Instant League',

  -- Cotes au moment de la prédiction
  odd_home DECIMAL(6,2),
  odd_draw DECIMAL(6,2),
  odd_away DECIMAL(6,2),

  -- Probabilités calculées
  prob_home DECIMAL(5,2),
  prob_draw DECIMAL(5,2),
  prob_away DECIMAL(5,2),

  -- Prédiction
  prediction TEXT NOT NULL, -- '1', 'X', ou '2'
  confidence DECIMAL(5,2) NOT NULL, -- Pourcentage de confiance
  winner_1x2 TEXT,

  -- Score prédit
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  predicted_score TEXT,
  score_home INTEGER,
  score_away INTEGER,
  exact_score TEXT,

  -- Autres prédictions
  gg_result TEXT,
  total_goals INTEGER,
  parity TEXT,
  over_under_15 TEXT,
  over_under_25 TEXT,
  over_under_35 TEXT,
  prob_gg DECIMAL(5,2),
  prob_gn DECIMAL(5,2),
  btts_prob DECIMAL(5,2),
  over25_prob DECIMAL(5,2),
  first_half_goal_prob DECIMAL(5,2),
  expected_goals DECIMAL(5,2),
  goals_home DECIMAL(5,2),
  goals_away DECIMAL(5,2),

  -- Résultat réel (rempli après vérification)
  actual_home_score INTEGER,
  actual_away_score INTEGER,
  actual_outcome TEXT, -- '1', 'X', ou '2'
  actual_score TEXT,

  -- Statut
  status TEXT DEFAULT 'pending', -- 'pending', 'correct', 'incorrect'
  verified_at TIMESTAMP WITH TIME ZONE,

  -- Métadonnées
  device_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Créer les index
CREATE INDEX idx_predictions_status ON predictions(status);
CREATE INDEX idx_predictions_created ON predictions(created_at DESC);
CREATE INDEX idx_predictions_device ON predictions(device_id);
CREATE INDEX idx_predictions_match ON predictions(match_id);

-- 4. Activer RLS
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

-- 5. Créer les politiques RLS
CREATE POLICY "Public can read predictions" ON predictions
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Public can insert predictions" ON predictions
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Public can update predictions" ON predictions
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public can delete predictions" ON predictions
  FOR DELETE TO anon, authenticated
  USING (true);

-- 6. Vérifier que la table est créée
SELECT 'predictions table created successfully' as status;
