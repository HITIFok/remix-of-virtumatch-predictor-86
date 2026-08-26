-- Table pour suivre les prédictions et leur précision
CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Infos du match
  match_id BIGINT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
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
  
  -- Score prédit
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  predicted_score TEXT,
  
  -- Résultat réel (rempli après vérification)
  actual_home_score INTEGER,
  actual_away_score INTEGER,
  actual_outcome TEXT, -- '1', 'X', ou '2'
  actual_score TEXT,
  
  -- Statut
  status TEXT DEFAULT 'pending', -- 'pending', 'correct', 'incorrect'
  verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Métadonnées
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Contrainte unique pour éviter les doublons
  UNIQUE(match_id, created_at::date)
);

-- Index pour les requêtes rapides
CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
CREATE INDEX IF NOT EXISTS idx_predictions_created ON predictions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);

-- Table pour les statistiques globales
CREATE TABLE IF NOT EXISTS prediction_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE DEFAULT CURRENT_DATE,
  
  -- Compteurs
  total_predictions INTEGER DEFAULT 0,
  correct_predictions INTEGER DEFAULT 0,
  incorrect_predictions INTEGER DEFAULT 0,
  pending_predictions INTEGER DEFAULT 0,
  
  -- Précision
  accuracy DECIMAL(5,2) DEFAULT 0,
  
  -- Par type de prédiction
  home_wins_predicted INTEGER DEFAULT 0,
  home_wins_correct INTEGER DEFAULT 0,
  draws_predicted INTEGER DEFAULT 0,
  draws_correct INTEGER DEFAULT 0,
  away_wins_predicted INTEGER DEFAULT 0,
  away_wins_correct INTEGER DEFAULT 0,
  
  -- Par niveau de confiance
  high_confidence_total INTEGER DEFAULT 0, -- >= 70%
  high_confidence_correct INTEGER DEFAULT 0,
  medium_confidence_total INTEGER DEFAULT 0, -- 50-69%
  medium_confidence_correct INTEGER DEFAULT 0,
  low_confidence_total INTEGER DEFAULT 0, -- < 50%
  low_confidence_correct INTEGER DEFAULT 0,
  
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(date)
);

-- Activer RLS
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_stats ENABLE ROW LEVEL SECURITY;

-- Politiques RLS (lecture publique, écriture via service)
CREATE POLICY "Public can read predictions" ON predictions
  FOR SELECT USING (true);

CREATE POLICY "Public can read stats" ON prediction_stats
  FOR SELECT USING (true);

-- Fonction pour mettre à jour les stats automatiquement
CREATE OR REPLACE FUNCTION update_prediction_stats()
RETURNS void AS $$
BEGIN
  INSERT INTO prediction_stats (
    date, total_predictions, correct_predictions, incorrect_predictions, pending_predictions, accuracy,
    home_wins_predicted, home_wins_correct,
    draws_predicted, draws_correct,
    away_wins_predicted, away_wins_correct,
    high_confidence_total, high_confidence_correct,
    medium_confidence_total, medium_confidence_correct,
    low_confidence_total, low_confidence_correct
  )
  SELECT
    CURRENT_DATE,
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'correct'),
    COUNT(*) FILTER (WHERE status = 'incorrect'),
    COUNT(*) FILTER (WHERE status = 'pending'),
    ROUND(
      COUNT(*) FILTER (WHERE status = 'correct')::numeric / 
      NULLIF(COUNT(*) FILTER (WHERE status IN ('correct', 'incorrect')), 0) * 100, 
      2
    ),
    COUNT(*) FILTER (WHERE prediction = '1'),
    COUNT(*) FILTER (WHERE prediction = '1' AND status = 'correct'),
    COUNT(*) FILTER (WHERE prediction = 'X'),
    COUNT(*) FILTER (WHERE prediction = 'X' AND status = 'correct'),
    COUNT(*) FILTER (WHERE prediction = '2'),
    COUNT(*) FILTER (WHERE prediction = '2' AND status = 'correct'),
    COUNT(*) FILTER (WHERE confidence >= 70),
    COUNT(*) FILTER (WHERE confidence >= 70 AND status = 'correct'),
    COUNT(*) FILTER (WHERE confidence >= 50 AND confidence < 70),
    COUNT(*) FILTER (WHERE confidence >= 50 AND confidence < 70 AND status = 'correct'),
    COUNT(*) FILTER (WHERE confidence < 50),
    COUNT(*) FILTER (WHERE confidence < 50 AND status = 'correct')
  FROM predictions
  WHERE created_at::date = CURRENT_DATE
  ON CONFLICT (date) DO UPDATE SET
    total_predictions = EXCLUDED.total_predictions,
    correct_predictions = EXCLUDED.correct_predictions,
    incorrect_predictions = EXCLUDED.incorrect_predictions,
    pending_predictions = EXCLUDED.pending_predictions,
    accuracy = EXCLUDED.accuracy,
    home_wins_predicted = EXCLUDED.home_wins_predicted,
    home_wins_correct = EXCLUDED.home_wins_correct,
    draws_predicted = EXCLUDED.draws_predicted,
    draws_correct = EXCLUDED.draws_correct,
    away_wins_predicted = EXCLUDED.away_wins_predicted,
    away_wins_correct = EXCLUDED.away_wins_correct,
    high_confidence_total = EXCLUDED.high_confidence_total,
    high_confidence_correct = EXCLUDED.high_confidence_correct,
    medium_confidence_total = EXCLUDED.medium_confidence_total,
    medium_confidence_correct = EXCLUDED.medium_confidence_correct,
    low_confidence_total = EXCLUDED.low_confidence_total,
    low_confidence_correct = EXCLUDED.low_confidence_correct,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
