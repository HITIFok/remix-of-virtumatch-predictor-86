
-- Table pour l'historique des prédictions (public, pas d'auth)
CREATE TABLE public.predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  odd_home NUMERIC NOT NULL,
  odd_draw NUMERIC NOT NULL,
  odd_away NUMERIC NOT NULL,
  prob_home NUMERIC NOT NULL,
  prob_draw NUMERIC NOT NULL,
  prob_away NUMERIC NOT NULL,
  winner_1x2 TEXT NOT NULL,
  first_half_goal_prob NUMERIC NOT NULL,
  expected_goals NUMERIC NOT NULL,
  goals_home NUMERIC NOT NULL,
  goals_away NUMERIC NOT NULL,
  score_home INTEGER NOT NULL,
  score_away INTEGER NOT NULL,
  exact_score TEXT NOT NULL,
  prob_gg NUMERIC NOT NULL,
  prob_gn NUMERIC NOT NULL,
  gg_result TEXT NOT NULL,
  total_goals INTEGER NOT NULL,
  parity TEXT NOT NULL,
  over_under_15 TEXT NOT NULL,
  over_under_25 TEXT NOT NULL,
  over_under_35 TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour les codes d'accès premium
CREATE TABLE public.access_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  duration_days INTEGER NOT NULL DEFAULT 30,
  used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMP WITH TIME ZONE,
  used_by_device TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_codes ENABLE ROW LEVEL SECURITY;

-- Predictions: anyone can insert and read (no auth, device-based)
CREATE POLICY "Anyone can insert predictions"
  ON public.predictions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can read predictions"
  ON public.predictions FOR SELECT
  USING (true);

CREATE POLICY "Anyone can delete their predictions"
  ON public.predictions FOR DELETE
  USING (true);

-- Access codes: anyone can read (to validate), only insert via admin (we handle in app logic)
CREATE POLICY "Anyone can read access codes"
  ON public.access_codes FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert access codes"
  ON public.access_codes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update access codes"
  ON public.access_codes FOR UPDATE
  USING (true);
