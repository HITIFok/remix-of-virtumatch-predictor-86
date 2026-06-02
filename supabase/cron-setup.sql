-- ===========================================
-- Configuration Cron Supabase
-- auto-scrape (toutes les 2 min)
-- verify-predictions (toutes les 5 min)
-- ===========================================
-- Exécutez ce SQL dans l'éditeur SQL de Supabase
-- ⚠️ La clé secrète doit être définie via Supabase Secrets (Dashboard → Settings → Secrets)
--    Nom : CRON_SECRET
--    Valeur : votre clé secrète personnalisée
-- ===========================================

-- 1. Activer l'extension pg_cron (si pas déjà activée)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Créer la table de logs (optionnel)
CREATE TABLE IF NOT EXISTS cron_logs (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  job_name TEXT DEFAULT '',
  response JSONB
);

-- ═══════════════════════════════════════════
-- CRON JOB 1 : auto-scrape (toutes les 2 min)
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION call_auto_scrape()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  response json;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'CRON_SECRET'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'CRON_SECRET not found in vault';
  END IF;

  SELECT net.http_post(
    url := 'REDACTED_DATABASE_URL/functions/v1/auto-scrape',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', v_secret
    ),
    body := '{}'::jsonb
  ) INTO response;

  INSERT INTO cron_logs (created_at, job_name, response)
  VALUES (now(), 'auto-scrape', response);
END;
$$;

-- 3. Programmer auto-scrape (toutes les 2 minutes)
SELECT cron.schedule(
  'auto-scrape-instant-league',
  '*/2 * * * *',
  'SELECT call_auto_scrape();'
);

-- ═══════════════════════════════════════════
-- CRON JOB 2 : verify-predictions (toutes les 5 min)
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION call_verify_predictions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  response json;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'CRON_SECRET'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'CRON_SECRET not found in vault';
  END IF;

  SELECT net.http_post(
    url := 'REDACTED_DATABASE_URL/functions/v1/verify-predictions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', v_secret
    ),
    body := '{}'::jsonb
  ) INTO response;

  INSERT INTO cron_logs (created_at, job_name, response)
  VALUES (now(), 'verify-predictions', response);
END;
$$;

-- 4. Programmer verify-predictions (toutes les 5 minutes)
SELECT cron.schedule(
  'verify-predictions-auto',
  '*/5 * * * *',
  'SELECT call_verify_predictions();'
);

-- ═══════════════════════════════════════════
-- UTILITAIRES
-- ═══════════════════════════════════════════

-- Voir tous les jobs cron actifs :
-- SELECT * FROM cron.job;

-- Voir les logs récents :
-- SELECT created_at, job_name, response->>'message' as msg FROM cron_logs ORDER BY created_at DESC LIMIT 20;

-- Supprimer un job :
-- SELECT cron.unschedule('auto-scrape-instant-league');
-- SELECT cron.unschedule('verify-predictions-auto');
