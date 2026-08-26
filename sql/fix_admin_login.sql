-- ============================================================================
-- FIX ADMIN LOGIN — Diagnostic + Réparation
-- Exécuter dans le SQL Editor de Supabase
-- ============================================================================

-- ─── ÉTAPE 1 : Vérifier l'état actuel de la fonction ──────────────────────────
SELECT 'DIAGNOSTIC' AS step;
SELECT proname, prosrc, prosecdef, proconfig
FROM pg_proc
WHERE proname = 'verify_admin_password';

-- Vérifier les permissions
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name = 'verify_admin_password';

-- Vérifier si un hash existe dans admin_settings
SELECT setting_key, LEFT(setting_value, 20) || '...' AS hash_preview
FROM admin_settings
WHERE setting_key = 'admin_code';

-- ─── ÉTAPE 2 : Réparer la fonction verify_admin_password ─────────────────────
-- Supprimer et recréer proprement (FIX #9 avait une syntaxe DO $$ incorrecte)

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

  -- Comparaison bcrypt — extensions.crypt() via search_path explicite
  RETURN (stored_hash = extensions.crypt(input_password, stored_hash));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, extensions;

-- Accorder uniquement au service_role (comme FIX #7 le voulait)
REVOKE EXECUTE ON FUNCTION public.verify_admin_password(text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_admin_password(text) TO service_role;

SELECT 'Function recreated successfully' AS status;

-- ─── ÉTAPE 3 : Mettre à jour le mot de passe admin ────────────────────────────
-- ⚠️ REMPLACEZ 'VOTRE_VRAI_MOT_DE_PASSE' par votre vrai mot de passe admin
-- puis décommentez les 3 lignes ci-dessous avant d'exécuter :

/*
UPDATE admin_settings
SET setting_value = extensions.crypt('VOTRE_VRAI_MOT_DE_PASSE', extensions.gen_salt('bf')),
    updated_at = NOW()
WHERE setting_key = 'admin_code';
*/

-- ─── ÉTAPE 4 : Vérification finale ───────────────────────────────────────────
SELECT 'VERIFICATION' AS step;
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE proname = 'verify_admin_password';

SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name = 'verify_admin_password';

-- Test rapide (remplacez par votre vrai mot de passe pour tester)
-- SELECT verify_admin_password('VOTRE_VRAI_MOT_DE_PASSE') AS test_result;