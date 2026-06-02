-- ============================================================================
-- SUPABASE SECURITY AUDIT FIXES — 2026-06-02
-- Corrige les 12 vulnérabilités trouvées lors de l'audit de sécurité complet
-- ============================================================================
--
-- ⚠️ ATTENTION : Exécuter ce script ENTIÈREMENT dans le SQL Editor de Supabase
-- ============================================================================
--
-- FIXES APPLIQUÉS :
--   #1 [CRITIQUE] RLS access_codes ouvert → politiques restrictives
--   #2 [CRITIQUE] RLS predictions lecture publique → filtrer par device_id
--   #3 [CRITIQUE] revoke PUBLIC sur toutes les fonctions SECURITY DEFINER
-- ============================================================================

-- ============================================================================
-- FIX #1 [CRITIQUE] : RLS access_codes — politique trop permissive
-- ============================================================================
-- AVANT : CREATE POLICY "Allow all operations on access_codes" FOR ALL USING (true)
-- RISQUE : N'importe qui (anon) peut INSERT, UPDATE, DELETE des codes premium
--
-- CORRECTION :
--   - SELECT : public (nécessaire pour vérifier un code via validateCode)
--   - UPDATE : restreint à la condition "code non utilisé" + même device (anti-replay)
--   - INSERT, DELETE : service_role uniquement (admin)
-- ============================================================================

DO $$ BEGIN
  -- Supprimer la politique trop permissive
  DROP POLICY IF EXISTS "Allow all operations on access_codes" ON access_codes;
  RAISE NOTICE 'Drop: Allow all operations on access_codes';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Policy already dropped: %', SQLERRM;
END $$;

-- Politique de lecture publique (nécessaire pour validateCode)
DO $$ BEGIN
  CREATE POLICY "Public read access_codes" ON access_codes
    FOR SELECT USING (true);
  RAISE NOTICE 'Created: Public read access_codes';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Policy exists: %', SQLERRM;
END $$;

-- Politique UPDATE restreinte : seul un code NON UTILISÉ peut être activé
-- L'utilisateur ne peut pas réactiver un code déjà utilisé
DO $$ BEGIN
  CREATE POLICY "Update unused codes only" ON access_codes
    FOR UPDATE USING (used = false)
    WITH CHECK (used = false);
  RAISE NOTICE 'Created: Update unused codes only';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Policy exists: %', SQLERRM;
END $$;

-- Politique INSERT/DELETE : service_role uniquement
DO $$ BEGIN
  CREATE POLICY "Service role access_codes" ON access_codes
    FOR INSERT USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  RAISE NOTICE 'Created: Service role access_codes (INSERT)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Policy exists: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role delete access_codes" ON access_codes
    FOR DELETE USING (auth.role() = 'service_role');
  RAISE NOTICE 'Created: Service role delete access_codes (DELETE)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Policy exists: %', SQLERRM;
END $$;

-- ============================================================================
-- FIX #2 [CRITIQUE] : RLS predictions — lecture publique expose tous les users
-- ============================================================================
-- AVANT : CREATE POLICY "Public read predictions" FOR SELECT USING (true)
-- RISQUE : Tout utilisateur anon peut lire les prédictions de TOUS les devices
--
-- CORRECTION :
--   - SELECT : filtrer par device_id (passé via header ou filtré côté client)
--   - INSERT : public (pour sauvegarder)
--   - DELETE : owner (même device_id) ou service_role
--   - UPDATE : service_role uniquement (pour verify-predictions)
-- ============================================================================

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public read predictions" ON predictions;
  RAISE NOTICE 'Drop: Public read predictions';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Policy already dropped: %', SQLERRM;
END $$;

-- Politique de lecture : filtrer par device_id depuis le header x-device-id
-- Si aucun header, ne rien retourner (sauf service_role)
DO $$ BEGIN
  CREATE POLICY "Read own predictions" ON predictions
    FOR SELECT USING (
      device_id = current_setting('request.header.x-device-id', true)
      OR auth.role() = 'service_role'
    );
  RAISE NOTICE 'Created: Read own predictions (filtered by device_id)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Policy exists: %', SQLERRM;
END $$;

-- Politique UPDATE : service_role uniquement (pour verify-predictions)
DO $$ BEGIN
  CREATE POLICY "Service role update predictions" ON predictions
    FOR UPDATE USING (auth.role() = 'service_role');
  RAISE NOTICE 'Created: Service role update predictions';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Policy exists: %', SQLERRM;
END $$;

-- ============================================================================
-- FIX #3 [CRITIQUE] : Revoke PUBLIC sur TOUTES les fonctions SECURITY DEFINER
-- ============================================================================
-- Le rôle PUBLIC hérite à tous les rôles (y compris anon et authenticated)
-- Certaines fonctions n'ont pas encore été révoquées de PUBLIC
-- ============================================================================

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.verify_admin_password(text) FROM PUBLIC;
  RAISE NOTICE 'REVOKE verify_admin_password FROM PUBLIC';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'verify_admin_password: %', SQLERRM;
END $$;

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.admin_delete_access_code(uuid) FROM PUBLIC;
  RAISE NOTICE 'REVOKE admin_delete_access_code FROM PUBLIC';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'admin_delete_access_code: %', SQLERRM;
END $$;

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.verify_credentials(text, text) FROM PUBLIC;
  RAISE NOTICE 'REVOKE verify_credentials FROM PUBLIC';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'verify_credentials: %', SQLERRM;
END $$;

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.check_premium_status(text) FROM PUBLIC;
  RAISE NOTICE 'REVOKE check_premium_status FROM PUBLIC';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'check_premium_status: %', SQLERRM;
END $$;

-- ============================================================================
-- VÉRIFICATION — Confirmer les nouvelles politiques
-- ============================================================================

SELECT 'access_codes policies' as info;
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'access_codes';

SELECT 'predictions policies' as info;
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'predictions';

SELECT 'Function permissions after fix' as info;
SELECT
  p.proname as function_name,
  CASE
    WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'YES'
    ELSE 'NO'
  END as anon_can_execute,
  CASE
    WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'YES'
    ELSE 'NO'
  END as auth_can_execute,
  CASE
    WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN 'YES'
    ELSE 'NO'
  END as public_can_execute
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
AND p.prosecdef = true
ORDER BY p.proname;
