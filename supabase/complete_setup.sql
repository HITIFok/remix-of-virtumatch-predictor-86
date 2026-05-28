-- =====================================================
-- SCRIPT DE CONFIGURATION COMPLÈTE SUPABASE
-- Exécutez ce script dans l'éditeur SQL de Supabase
-- =====================================================

-- 1. CRÉER LA TABLE ADMIN_SETTINGS SI ELLE N'EXISTE PAS
CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. INSÉRER LE MOT DE PASSE ADMIN HASHÉ (bcrypt)
-- ⚠️ Remplacez LE_HASH_BCRYPT_ICI par votre propre hash généré avec :
--    SELECT pgcrypto.crypt('VOTRE_MOT_DE_PASSE', pgcrypto.gen_salt('bf'));
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO admin_settings (setting_key, setting_value)
VALUES ('admin_code', 'LE_HASH_BCRYPT_ICI')
ON CONFLICT (setting_key)
DO UPDATE SET updated_at = NOW();

-- 3. CONFIGURER RLS POUR ADMIN_SETTINGS (sécurisé)
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access" ON admin_settings;
DROP POLICY IF EXISTS "Allow write access" ON admin_settings;
DROP POLICY IF EXISTS "Allow all access on admin_settings" ON admin_settings;
DROP POLICY IF EXISTS "Service role admin_settings" ON admin_settings;

-- Lecture : via la fonction RPC verify_admin_password uniquement (pas de SELECT direct)
CREATE POLICY "No direct read admin_settings" ON admin_settings
  FOR SELECT USING (false);

-- Écriture : service_role uniquement
CREATE POLICY "Service role admin_settings" ON admin_settings
  FOR ALL USING (auth.role() = 'service_role');

-- 4. CRÉER LA TABLE ACCESS_CODES SI ELLE N'EXISTE PAS
CREATE TABLE IF NOT EXISTS access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 30,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  used_by_device TEXT
);

-- 5. CONFIGURER RLS POUR ACCESS_CODES (sécurisé)
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access" ON access_codes;
DROP POLICY IF EXISTS "Allow read access" ON access_codes;
DROP POLICY IF EXISTS "Allow write access" ON access_codes;
DROP POLICY IF EXISTS "Allow all operations on access_codes" ON access_codes;
DROP POLICY IF EXISTS "Public read access_codes" ON access_codes;
DROP POLICY IF EXISTS "Service role access_codes" ON access_codes;

-- Lecture publique (nécessaire pour vérifier un code)
CREATE POLICY "Public read access_codes" ON access_codes
  FOR SELECT USING (true);

-- Écriture : service_role uniquement
CREATE POLICY "Service role access_codes" ON access_codes
  FOR ALL USING (auth.role() = 'service_role');

-- 6. CRÉER LA TABLE PREDICTIONS SI ELLE N'EXISTE PAS
CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home TEXT,
  away TEXT,
  league TEXT DEFAULT 'Instant League',
  odd_home FLOAT,
  odd_draw FLOAT,
  odd_away FLOAT,
  prob_home FLOAT,
  prob_draw FLOAT,
  prob_away FLOAT,
  prediction TEXT,
  confidence INTEGER,
  winner_1x2 TEXT,
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  predicted_score TEXT,
  score_home INTEGER,
  score_away INTEGER,
  exact_score TEXT,
  first_half_goal_prob FLOAT,
  expected_goals FLOAT,
  goals_home FLOAT,
  goals_away FLOAT,
  prob_gg FLOAT,
  prob_gn FLOAT,
  gg_result TEXT,
  total_goals INTEGER,
  parity TEXT,
  over_under_15 TEXT,
  over_under_25 TEXT,
  over_under_35 TEXT,
  btts_prob FLOAT,
  over25_prob FLOAT,
  device_id TEXT,
  match_id TEXT,
  status TEXT DEFAULT 'pending',
  actual_outcome TEXT,
  actual_score TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. CONFIGURER RLS POUR PREDICTIONS
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access" ON predictions;
DROP POLICY IF EXISTS "Allow all operations on predictions" ON predictions;
DROP POLICY IF EXISTS "Public read predictions" ON predictions;
DROP POLICY IF EXISTS "Public insert predictions" ON predictions;
DROP POLICY IF EXISTS "Service role predictions" ON predictions;

-- Lecture publique (nécessaire pour l'historique)
CREATE POLICY "Public read predictions" ON predictions
  FOR SELECT USING (true);

-- Insertion publique (pour sauvegarder les prédictions)
CREATE POLICY "Public insert predictions" ON predictions
  FOR INSERT WITH CHECK (true);

-- Suppression : owner uniquement (même device_id) OU service_role
CREATE POLICY "Delete own predictions" ON predictions
  FOR DELETE USING (
    device_id = (current_setting('request.header.x-device-id', true)) OR
    auth.role() = 'service_role'
  );

-- Service role : accès complet
CREATE POLICY "Service role predictions" ON predictions
  FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- VÉRIFICATION
-- =====================================================

SELECT 'access_codes' as table_name, COUNT(*) as count FROM access_codes
UNION ALL
SELECT 'predictions' as table_name, COUNT(*) as count FROM predictions;

SELECT '✅ Configuration Supabase terminée avec succès!' as status;
