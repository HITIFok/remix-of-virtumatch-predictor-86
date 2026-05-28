-- ===========================================
-- Configuration Cron Supabase pour auto-scrape
-- ===========================================
-- Exécutez ce SQL dans l'éditeur SQL de Supabase
-- ⚠️ La clé secrète doit être définie via Supabase Secrets (Dashboard → Settings → Secrets)
--    Nom : CRON_SECRET
--    Valeur : votre clé secrète personnalisée
-- ===========================================

-- 1. Activer l'extension pg_cron (si pas déjà activée)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Créer la fonction qui appelle l'Edge Function
-- La clé est lue depuis vault.secrets (définie dans Supabase Dashboard)
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
  -- Lire la clé secrète depuis le vault
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'CRON_SECRET'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'CRON_SECRET not found in vault. Add it in Supabase Dashboard → Settings → Secrets';
  END IF;

  -- Appeler l'Edge Function auto-scrape avec la clé secrète
  SELECT net.http_post(
    url := 'REDACTED_SUPABASE_URL/functions/v1/auto-scrape',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', v_secret
    ),
    body := '{}'::jsonb
  ) INTO response;

  -- Log le résultat
  INSERT INTO cron_logs (created_at, response)
  VALUES (now(), response);
END;
$$;

-- 3. Créer la table de logs (optionnel)
CREATE TABLE IF NOT EXISTS cron_logs (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  response JSONB
);

-- 4. Programmer le cron job (toutes les 2 minutes)
SELECT cron.schedule(
  'auto-scrape-instant-league',
  '*/2 * * * *',
  'SELECT call_auto_scrape();'
);

-- Pour voir les jobs cron actifs:
-- SELECT * FROM cron.job;

-- Pour supprimer un job:
-- SELECT cron.unschedule('auto-scrape-instant-league');
