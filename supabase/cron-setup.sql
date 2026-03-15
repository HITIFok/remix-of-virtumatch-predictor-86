-- ===========================================
-- Configuration Cron Supabase pour auto-scrape
-- ===========================================
-- Exécuter ce SQL dans l'éditeur SQL de Supabase

-- 1. Activer l'extension pg_cron (si pas déjà activée)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Définir le secret pour autoriser le cron
-- (Optionnel: peut aussi utiliser DATABASE_ANON_KEY)
INSERT INTO vault.secrets (name, secret)
VALUES ('CRON_SECRET', 'bet261_cron_2024_mada')
ON CONFLICT (name) DO UPDATE SET secret = 'bet261_cron_2024_mada';

-- 3. Créer la fonction qui appelle l'Edge Function
CREATE OR REPLACE FUNCTION call_auto_scrape()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response json;
BEGIN
  -- Appeler l'Edge Function auto-scrape
  SELECT net.http_post(
    url := 'https://gxmmeemzkixinsxglfaq.redacted.example.com/functions/v1/auto-scrape',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', 'bet261_cron_2024_mada'
    ),
    body := '{}'::jsonb
  ) INTO response;

  -- Log le résultat (optionnel)
  INSERT INTO cron_logs (created_at, response)
  VALUES (now(), response);
END;
$$;

-- 4. Créer la table de logs (optionnel)
CREATE TABLE IF NOT EXISTS cron_logs (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  response JSONB
);

-- 5. Programmer le cron job (toutes les 2 minutes)
SELECT cron.schedule(
  'auto-scrape-instant-league',
  '*/2 * * * *',  -- Toutes les 2 minutes
  'SELECT call_auto_scrape();'
);

-- Pour voir les jobs cron actifs:
-- SELECT * FROM cron.job;

-- Pour supprimer un job:
-- SELECT cron.unschedule('auto-scrape-instant-league');
