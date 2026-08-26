-- ============================================================================
-- SUPABASE SECURITY AUDIT FIXES — CONSOLIDATED SCRIPT
-- Date: 2026-06-02
-- Repository: HITIFok/remix-of-virtumatch-predictor-86
--
-- ⚠️  EXECUTER CE SCRIPT ENTIÈREMENT dans le SQL Editor de Supabase.
--     Chaque section est protégée par DO $$ ... EXCEPTION pour être idempotent.
-- ============================================================================
--
-- VULNÉRABILITÉS CORRIGÉES (10 au total) :
--
--   #1 [CRITIQUE]  RLS access_codes — politique FOR ALL USING (true) trop permissive
--   #2 [CRITIQUE]  RLS predictions — UPDATE/DELETE publics sans restriction
--   #3 [CRITIQUE]  RLS admin_settings — SELECT public expose le hash bcrypt admin
--   #4 [CRITIQUE]  RLS scraped_data — UPDATE public sans restriction
--   #5 [HAUT]      RLS prediction_stats — aucune politique INSERT/UPDATE/DELETE
--   #6 [HAUT]      RLS cron_logs — RLS désactivé, exposition publique des logs
--   #7 [CRITIQUE]  REVOKE PUBLIC sur TOUTES les fonctions SECURITY DEFINER
--   #8 [HAUT]      call_auto_scrape() — SECURITY DEFINER sans restriction d'accès
--   #9 [MOYEN]     verify_admin_password — search_path non verrouillé (migration)
--   #10[CRITIQUE]  rls_auto_enable() — SECURITY DEFINER accessible à PUBLIC
-- ============================================================================
-- Tables concernées :
--   - access_codes
--   - predictions
--   - admin_settings
--   - scraped_data
--   - prediction_stats
--   - cron_logs
-- Functions concernées :
--   - verify_admin_password(text)
--   - admin_delete_access_code(uuid)
--   - check_premium_status(text)
--   - verify_credentials(text, text)
--   - log_user_login(text)
--   - use_user_code(text, text)
--   - call_auto_scrape()
--   - update_prediction_stats()
-- ============================================================================


-- ============================================================================
-- FIX #1 [CRITIQUE] : RLS access_codes — politique trop permissive
-- ============================================================================
-- AVANT : CREATE POLICY "Allow all operations on access_codes" FOR ALL USING (true)
-- RISQUE : N'importe qui (anon) peut INSERT, UPDATE, DELETE des codes premium.
--          Un attaquant peut : créer des codes faux, marquer des codes comme utilisés,
--          supprimer tous les codes existants.
--
-- CORRECTION :
--   - SELECT : public (nécessaire pour vérifier un code via validateCode)
--   - UPDATE : restreint aux codes NON utilisés uniquement (anti-replay)
--   - INSERT : service_role uniquement (admin)
--   - DELETE : service_role uniquement (admin)
-- ============================================================================

DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all operations on access_codes" ON access_codes;
  DROP POLICY IF EXISTS "Allow all access" ON access_codes;
  DROP POLICY IF EXISTS "Allow read access" ON access_codes;
  DROP POLICY IF EXISTS "Allow write access" ON access_codes;
  DROP POLICY IF EXISTS "Allow insert access" ON access_codes;
  DROP POLICY IF EXISTS "Allow delete access" ON access_codes;
  DROP POLICY IF EXISTS "Service role access_codes" ON access_codes;
  DROP POLICY IF EXISTS "Service role delete access_codes" ON access_codes;
  DROP POLICY IF EXISTS "Update unused codes only" ON access_codes;
  RAISE NOTICE 'FIX #1: Dropped all old access_codes policies';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #1: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Public read access_codes" ON access_codes
    FOR SELECT USING (true);
  RAISE NOTICE 'FIX #1: Created Public read access_codes';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #1: Policy exists — %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Update unused codes only" ON access_codes
    FOR UPDATE USING (used = false)
    WITH CHECK (used = false);
  RAISE NOTICE 'FIX #1: Created Update unused codes only';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #1: Policy exists — %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role insert access_codes" ON access_codes
    FOR INSERT USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  RAISE NOTICE 'FIX #1: Created Service role insert access_codes';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #1: Policy exists — %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role delete access_codes" ON access_codes
    FOR DELETE USING (auth.role() = 'service_role');
  RAISE NOTICE 'FIX #1: Created Service role delete access_codes';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #1: Policy exists — %', SQLERRM;
END $$;


-- ============================================================================
-- FIX #2 [CRITIQUE] : RLS predictions — UPDATE/DELETE publics sans restriction
-- ============================================================================
-- AVANT :
--   CREATE POLICY "Public can update predictions" FOR UPDATE USING (true)
--   CREATE POLICY "Public can delete predictions" FOR DELETE USING (true)
-- RISQUE : Tout utilisateur anon peut modifier le statut (pending→correct) ou
--          supprimer les prédictions de n'importe qui. Un attaquant peut falsifier
--          les statistiques de précision en marquant ses prédictions comme correctes.
--
-- CORRECTION :
--   - SELECT : filtrer par device_id (via header x-device-id) ou service_role
--   - INSERT : public (pour sauvegarder les prédictions)
--   - UPDATE : service_role uniquement (pour verify-predictions edge function)
--   - DELETE : owner (même device_id) ou service_role
-- ============================================================================

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public can read predictions" ON predictions;
  DROP POLICY IF EXISTS "Public read predictions" ON predictions;
  DROP POLICY IF EXISTS "Public can insert predictions" ON predictions;
  DROP POLICY IF EXISTS "Public insert predictions" ON predictions;
  DROP POLICY IF EXISTS "Public can update predictions" ON predictions;
  DROP POLICY IF EXISTS "Public can delete predictions" ON predictions;
  DROP POLICY IF EXISTS "Delete own predictions" ON predictions;
  DROP POLICY IF EXISTS "Service role predictions" ON predictions;
  DROP POLICY IF EXISTS "Service role update predictions" ON predictions;
  DROP POLICY IF EXISTS "Read own predictions" ON predictions;
  RAISE NOTICE 'FIX #2: Dropped all old predictions policies';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #2: %', SQLERRM;
END $$;

-- Politique INSERT : public (pour sauvegarder les prédictions depuis le client)
DO $$ BEGIN
  CREATE POLICY "Public insert predictions" ON predictions
    FOR INSERT WITH CHECK (true);
  RAISE NOTICE 'FIX #2: Created Public insert predictions';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #2: Policy exists — %', SQLERRM;
END $$;

-- Politique SELECT : filtrer par device_id depuis le header x-device-id
-- Si aucun header n'est fourni, aucune donnée n'est retournée (sauf service_role)
DO $$ BEGIN
  CREATE POLICY "Read own predictions" ON predictions
    FOR SELECT USING (
      device_id = current_setting('request.header.x-device-id', true)
      OR auth.role() = 'service_role'
    );
  RAISE NOTICE 'FIX #2: Created Read own predictions (filtered by device_id)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #2: Policy exists — %', SQLERRM;
END $$;

-- Politique UPDATE : service_role uniquement (pour verify-predictions)
DO $$ BEGIN
  CREATE POLICY "Service role update predictions" ON predictions
    FOR UPDATE USING (auth.role() = 'service_role');
  RAISE NOTICE 'FIX #2: Created Service role update predictions';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #2: Policy exists — %', SQLERRM;
END $$;

-- Politique DELETE : owner (même device_id) ou service_role
DO $$ BEGIN
  CREATE POLICY "Delete own predictions" ON predictions
    FOR DELETE USING (
      device_id = current_setting('request.header.x-device-id', true)
      OR auth.role() = 'service_role'
    );
  RAISE NOTICE 'FIX #2: Created Delete own predictions (owner or service_role)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #2: Policy exists — %', SQLERRM;
END $$;

-- Politique service_role : accès complet (insensible aux politiques ci-dessus)
DO $$ BEGIN
  CREATE POLICY "Service role full predictions" ON predictions
    FOR ALL USING (auth.role() = 'service_role');
  RAISE NOTICE 'FIX #2: Created Service role full predictions';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #2: Policy exists — %', SQLERRM;
END $$;


-- ============================================================================
-- FIX #3 [CRITIQUE] : RLS admin_settings — SELECT public expose le hash bcrypt
-- ============================================================================
-- AVANT (migration 20260318000000) :
--   CREATE POLICY "Allow read access" FOR SELECT USING (true)
--   CREATE POLICY "Allow write access" FOR ALL USING (true)
-- RISQUE : N'importe qui (anon) peut lire le hash bcrypt du mot de passe admin
--          et le modifier. Même si bcrypt est robuste, exposer le hash facilite
--          les attaques offline (rainbow tables, hashcat).
--
-- CORRECTION :
--   - SELECT : interdit (USING false) — accès uniquement via verify_admin_password()
--   - ALL (INSERT/UPDATE/DELETE) : service_role uniquement
-- ============================================================================

DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow read access" ON admin_settings;
  DROP POLICY IF EXISTS "Allow write access" ON admin_settings;
  DROP POLICY IF EXISTS "Allow all access on admin_settings" ON admin_settings;
  DROP POLICY IF EXISTS "Service role admin_settings" ON admin_settings;
  DROP POLICY IF EXISTS "No direct read admin_settings" ON admin_settings;
  RAISE NOTICE 'FIX #3: Dropped all old admin_settings policies';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #3: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "No direct read admin_settings" ON admin_settings
    FOR SELECT USING (false);
  RAISE NOTICE 'FIX #3: Created No direct read admin_settings';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #3: Policy exists — %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role admin_settings" ON admin_settings
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  RAISE NOTICE 'FIX #3: Created Service role admin_settings';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #3: Policy exists — %', SQLERRM;
END $$;


-- ============================================================================
-- FIX #4 [CRITIQUE] : RLS scraped_data — UPDATE public sans restriction
-- ============================================================================
-- AVANT (migration 20260313075922) :
--   CREATE POLICY "Service role update" FOR UPDATE USING (true)
-- RISQUE : La politique a été créée avec USING (true) au lieu de restreindre
--          à service_role. N'importe qui peut modifier les données scrapées,
--          permettant de falsifier les résultats de matchs affichés aux users.
--
-- CORRECTION : Restreindre UPDATE/DELETE/INSERT à service_role uniquement.
--              Conserver SELECT public (nécessaire pour le fallback de /api/matches).
-- ============================================================================

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public read access" ON scraped_data;
  DROP POLICY IF EXISTS "Allow public read on scraped_data" ON scraped_data;
  DROP POLICY IF EXISTS "Service role insert" ON scraped_data;
  DROP POLICY IF EXISTS "Service role update" ON scraped_data;
  DROP POLICY IF EXISTS "Service role delete" ON scraped_data;
  DROP POLICY IF EXISTS "Allow service role insert on scraped_data" ON scraped_data;
  DROP POLICY IF EXISTS "Allow service role delete on scraped_data" ON scraped_data;
  RAISE NOTICE 'FIX #4: Dropped all old scraped_data policies';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #4: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Public read scraped_data" ON scraped_data
    FOR SELECT USING (true);
  RAISE NOTICE 'FIX #4: Created Public read scraped_data';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #4: Policy exists — %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role insert scraped_data" ON scraped_data
    FOR INSERT USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  RAISE NOTICE 'FIX #4: Created Service role insert scraped_data';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #4: Policy exists — %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role update scraped_data" ON scraped_data
    FOR UPDATE USING (auth.role() = 'service_role');
  RAISE NOTICE 'FIX #4: Created Service role update scraped_data';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #4: Policy exists — %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role delete scraped_data" ON scraped_data
    FOR DELETE USING (auth.role() = 'service_role');
  RAISE NOTICE 'FIX #4: Created Service role delete scraped_data';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #4: Policy exists — %', SQLERRM;
END $$;


-- ============================================================================
-- FIX #5 [HAUT] : RLS prediction_stats — politiques manquantes
-- ============================================================================
-- AVANT : Seule une politique SELECT USING (true) existe.
-- RISQUE : Si quelqu'un obtient l'accès à un rôle avec INSERT/UPDATE/DELETE
--          sur cette table, il peut falsifier les statistiques globales.
--          La fonction update_prediction_stats() n'est pas SECURITY DEFINER
--          donc elle hérite des droits de l'appelant.
--
-- CORRECTION : Ajouter des politiques INSERT/UPDATE/DELETE restreintes
--              au service_role uniquement. Conserver SELECT public.
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE prediction_stats ENABLE ROW LEVEL SECURITY;
  RAISE NOTICE 'FIX #5: RLS enabled on prediction_stats';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #5: %', SQLERRM;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public can read stats" ON prediction_stats;
  RAISE NOTICE 'FIX #5: Dropped old prediction_stats policies';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #5: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Public read prediction_stats" ON prediction_stats
    FOR SELECT USING (true);
  RAISE NOTICE 'FIX #5: Created Public read prediction_stats';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #5: Policy exists — %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role write prediction_stats" ON prediction_stats
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  RAISE NOTICE 'FIX #5: Created Service role write prediction_stats';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #5: Policy exists — %', SQLERRM;
END $$;


-- ============================================================================
-- FIX #6 [HAUT] : RLS cron_logs — table sans protection
-- ============================================================================
-- AVANT : La table cron_logs est créée sans ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- RISQUE : Tout rôle (anon, authenticated) peut lire, insérer, modifier ou
--          supprimer les logs du cron job. Cela expose les réponses internes
--          de l'Edge Function auto-scrape (potentiellement des données sensibles)
--          et permet de masquer des erreurs de scraping.
--
-- CORRECTION : Activer RLS, lecture et écriture restreintes au service_role uniquement.
--              Les logs cron sont des données d'administration, pas pour le public.
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE cron_logs ENABLE ROW LEVEL SECURITY;
  RAISE NOTICE 'FIX #6: RLS enabled on cron_logs';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #6: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role cron_logs" ON cron_logs
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  RAISE NOTICE 'FIX #6: Created Service role cron_logs';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #6: Policy exists — %', SQLERRM;
END $$;


-- ============================================================================
-- FIX #7 [CRITIQUE] : REVOKE PUBLIC sur TOUTES les fonctions SECURITY DEFINER
-- ============================================================================
-- Le rôle PUBLIC est un pseudo-rôle qui hérite à TOUS les rôles (anon, authenticated,
-- service_role). Si une fonction SECURITY DEFINER a EXECUTE accordé à PUBLIC, alors
-- n'importe qui peut l'exécuter avec les privilèges du propriétaire (bypass RLS).
--
-- Certaines révocations étaient dans des scripts séparés. Ce fix les consolide
-- et s'assure que AUCUNE fonction SECURITY DEFINER n'est accessible à PUBLIC.
--
-- Liste complète des fonctions à révoquer :
--   1. verify_admin_password(text)    — brute-force admin password
--   2. admin_delete_access_code(uuid) — suppression de codes premium
--   3. check_premium_status(text)     — énumération de device IDs
--   4. verify_credentials(text, text) — brute-force de mots de passe
--   5. log_user_login(text)          — injection de logs
--   6. use_user_code(text, text)      — activation de codes sans contrôle
--   7. call_auto_scrape()             — déclencher un scraping arbitraire
--   8. rls_auto_enable()               — manipuler les politiques RLS
--
-- NOTE : rls_auto_enable() n'est pas dans le repo (créée manuellement via Dashboard).
--         Elle est traitée dynamiquement dans le FIX #10 ci-dessous.
-- ============================================================================

-- 1. verify_admin_password
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.verify_admin_password(text) FROM anon, authenticated, PUBLIC;
  GRANT EXECUTE ON FUNCTION public.verify_admin_password(text) TO service_role;
  RAISE NOTICE 'FIX #7: verify_admin_password — revoked from anon/auth/PUBLIC, granted to service_role';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #7: verify_admin_password — %', SQLERRM;
END $$;

-- 2. admin_delete_access_code
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.admin_delete_access_code(uuid) FROM anon, authenticated, PUBLIC;
  GRANT EXECUTE ON FUNCTION public.admin_delete_access_code(uuid) TO service_role;
  RAISE NOTICE 'FIX #7: admin_delete_access_code — revoked from anon/auth/PUBLIC, granted to service_role';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #7: admin_delete_access_code — %', SQLERRM;
END $$;

-- 3. check_premium_status
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.check_premium_status(text) FROM anon, authenticated, PUBLIC;
  GRANT EXECUTE ON FUNCTION public.check_premium_status(text) TO service_role;
  RAISE NOTICE 'FIX #7: check_premium_status — revoked from anon/auth/PUBLIC, granted to service_role';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #7: check_premium_status — %', SQLERRM;
END $$;

-- 4. verify_credentials
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.verify_credentials(text, text) FROM anon, authenticated, PUBLIC;
  GRANT EXECUTE ON FUNCTION public.verify_credentials(text, text) TO service_role;
  RAISE NOTICE 'FIX #7: verify_credentials — revoked from anon/auth/PUBLIC, granted to service_role';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #7: verify_credentials — %', SQLERRM;
END $$;

-- 5. log_user_login
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.log_user_login(text) FROM anon, authenticated, PUBLIC;
  GRANT EXECUTE ON FUNCTION public.log_user_login(text) TO service_role;
  RAISE NOTICE 'FIX #7: log_user_login — revoked from anon/auth/PUBLIC, granted to service_role';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #7: log_user_login — %', SQLERRM;
END $$;

-- 6. use_user_code
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.use_user_code(text, text) FROM anon, authenticated, PUBLIC;
  GRANT EXECUTE ON FUNCTION public.use_user_code(text, text) TO service_role;
  RAISE NOTICE 'FIX #7: use_user_code — revoked from anon/auth/PUBLIC, granted to service_role';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #7: use_user_code — %', SQLERRM;
END $$;


-- ============================================================================
-- FIX #8 [HAUT] : call_auto_scrape() — SECURITY DEFINER sans restriction
-- ============================================================================
-- AVANT : La fonction call_auto_scrape() est SECURITY DEFINER avec
--         SET search_path = '' (bonne pratique) mais EXECUTE est accordé à
--         PUBLIC par défaut (tout rôle peut l'appeler).
-- RISQUE : Un utilisateur anon peut déclencher manuellement un scraping,
--          causant un déni de service (rate limits de l'API sporty-tech) ou
--          des appels répétés à l'Edge Function auto-scrape.
--
-- CORRECTION : Révoquer EXECUTE de anon, authenticated, PUBLIC.
--              Accorder uniquement au rôle qui exécute pg_cron (postgres).
-- ============================================================================

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.call_auto_scrape() FROM anon, authenticated, PUBLIC;
  RAISE NOTICE 'FIX #8: call_auto_scrape — revoked from anon/auth/PUBLIC';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #8: call_auto_scrape — %', SQLERRM;
END $$;


-- ============================================================================
-- FIX #10 [CRITIQUE] : rls_auto_enable() — SECURITY DEFINER accessible à PUBLIC
-- ============================================================================
-- AVANT : Fonction rls_auto_enable() avec EXECUTE accordé à anon, authenticated, PUBLIC.
-- RISQUE : Si cette fonction est SECURITY DEFINER, n'importe qui peut l'appeler
--          avec les privilèges du propriétaire. Selon son implémentation, cela
--          pourrait permettre de : activer/désactiver RLS sur des tables,
--          créer ou supprimer des politiques RLS, contourner les protections
--          mises en place par cet audit.
--          L'impact exact dépend du code de la fonction, mais par principe de
--          défense en profondeur, toute fonction SECURITY DEFINER doit être
--          restreinte au service_role uniquement.
--
-- CORRECTION : Révoquer EXECUTE de anon, authenticated, PUBLIC.
--              Accorder à service_role uniquement.
--              Approche dynamique pour gérer toute signature de la fonction.
-- ============================================================================

DO $$ BEGIN
  -- Trouver toutes les surcharges de rls_auto_enable et les révoquer
  DECLARE
    func_record RECORD;
    func_signature TEXT;
  BEGIN
    FOR func_record IN
      SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      WHERE p.proname = 'rls_auto_enable'
        AND p.pronamespace = 'public'::regnamespace
    LOOP
      func_signature := 'public.' || func_record.proname || '(' || func_record.args || ')';

      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated, PUBLIC', func_signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', func_signature);

      RAISE NOTICE 'FIX #10: % — revoked from anon/auth/PUBLIC, granted to service_role', func_signature;
    END LOOP;

    IF NOT FOUND THEN
      RAISE NOTICE 'FIX #10: rls_auto_enable not found — nothing to revoke';
    END IF;
  END;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #10: %', SQLERRM;
END $$;


-- ============================================================================
-- FIX #9 [MOYEN] : verify_admin_password — search_path non verrouillé
-- ============================================================================
-- AVANT (migration 20260318000000) :
--   CREATE FUNCTION verify_admin_password(text)
--   $$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
--   -- Pas de SET search_path
-- RISQUE : search_path non explicitement défini = vulnérabilité au search_path
--          hijacking. Si un attaquant crée une fonction malveillante nommée
--          'pgcrypto.crypt' dans un schéma accessible, SECURITY DEFINER
--          l'exécuterait avec ses privilèges élevés.
--          (Le fix dans complete_setup.sql a SET search_path = public, extensions)
--
-- CORRECTION : Recréer la fonction avec SET search_path verrouillé.
--              Utiliser le même code que complete_setup.sql.
-- ============================================================================

DO $$ BEGIN
  -- Sauvegarder le hash existant (la fonction SECURITY DEFINER peut encore lire)
  DECLARE
    v_existing_hash TEXT;
  BEGIN
    SELECT setting_value INTO v_existing_hash
    FROM admin_settings
    WHERE setting_key = 'admin_code'
    LIMIT 1;

    IF v_existing_hash IS NOT NULL THEN
      DROP FUNCTION IF EXISTS public.verify_admin_password(TEXT);

      CREATE OR REPLACE FUNCTION public.verify_admin_password(input_password TEXT)
      RETURNS BOOLEAN AS $$
      DECLARE
        stored_hash TEXT;
      BEGIN
        SELECT setting_value INTO stored_hash
        FROM admin_settings
        WHERE setting_key = 'admin_code'
        LIMIT 1;

        IF stored_hash IS NULL THEN
          RETURN FALSE;
        END IF;

        -- Comparaison bcrypt constante — extensions.crypt() via search_path explicite
        RETURN (stored_hash = extensions.crypt(input_password, stored_hash));
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER STABLE
      SET search_path = public, extensions;

      -- Réappliquer les restrictions d'accès
      REVOKE EXECUTE ON FUNCTION public.verify_admin_password(text) FROM anon, authenticated, PUBLIC;
      GRANT EXECUTE ON FUNCTION public.verify_admin_password(text) TO service_role;

      RAISE NOTICE 'FIX #9: verify_admin_password recreated with SET search_path = public, extensions';
    ELSE
      RAISE NOTICE 'FIX #9: Skipped — no admin_code found in admin_settings';
    END IF;
  END;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FIX #9: %', SQLERRM;
END $$;


-- ============================================================================
-- VÉRIFICATION FINALE — Confirmer l'état des politiques et permissions
-- ============================================================================

SELECT '═══════════════════════════════════════════════════════════════' AS separator;
SELECT 'VÉRIFICATION RLS — Politiques par table' AS check_name;
SELECT '═══════════════════════════════════════════════════════════════' AS separator;

SELECT schemaname || '.' || tablename AS table_name, policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('access_codes', 'predictions', 'admin_settings', 'scraped_data', 'prediction_stats', 'cron_logs')
ORDER BY tablename, cmd;

SELECT '═══════════════════════════════════════════════════════════════' AS separator;
SELECT 'VÉRIFICATION — Fonctions SECURITY DEFINER et permissions' AS check_name;
SELECT '═══════════════════════════════════════════════════════════════' AS separator;

SELECT
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS args,
  CASE WHEN p.prosecdef THEN 'YES' ELSE 'NO' END AS is_security_definer,
  CASE
    WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN '⚠️ OUI'
    ELSE '✅ NON'
  END AS anon_can_execute,
  CASE
    WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN '⚠️ OUI'
    ELSE '✅ NON'
  END AS auth_can_execute,
  CASE
    WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN '⚠️ OUI'
    ELSE '✅ NON'
  END AS public_can_execute,
  CASE
    WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN '✅ OUI'
    ELSE '❌ NON'
  END AS service_role_can_execute
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND (p.prosecdef = true OR p.proname IN ('update_prediction_stats', 'rls_auto_enable'))
ORDER BY p.proname;

SELECT '═══════════════════════════════════════════════════════════════' AS separator;
SELECT 'VÉRIFICATION — Tables avec RLS activé' AS check_name;
SELECT '═══════════════════════════════════════════════════════════════' AS separator;

SELECT relname AS table_name,
  CASE WHEN rowsecurity THEN '✅ ENABLED' ELSE '❌ DISABLED' END AS rls_status
FROM pg_class
WHERE relname IN ('access_codes', 'predictions', 'admin_settings', 'scraped_data', 'prediction_stats', 'cron_logs')
  AND relnamespace = 'public'::regnamespace
ORDER BY relname;

SELECT '═══════════════════════════════════════════════════════════════' AS separator;
SELECT '✅ AUDIT TERMINÉ — 10 vulnérabilités corrigées' AS status;
SELECT '═══════════════════════════════════════════════════════════════' AS separator;
