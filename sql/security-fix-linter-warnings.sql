-- ============================================================================
-- SUPABASE SECURITY HARDENING — Vrai projet VirtuMatch
-- Corrige les warnings du Database Linter Supabase
-- Date: 2026-06-01
-- ============================================================================
--
-- ⚠️ ATTENTION : Exécuter ce script ENTIÈREMENT dans le SQL Editor de Supabase
-- Chaque section est protégée par DO $$ ... EXCEPTION pour éviter les erreurs
-- ============================================================================

-- ============================================================================
-- 1. FIX : log_user_login() — SECURITY DEFINER accessible publiquement (HAUT)
--    Risque: N'importe qui peut appeler cette fonction pour injecter des logs
--    Contexte: L'app appelle cette fonction via Vercel API Route (service_role)
--    Correction: Révoquer EXECUTE pour anon et authenticated
-- ============================================================================
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.log_user_login(p_pseudo text) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.log_user_login(p_pseudo text) FROM authenticated;
  REVOKE EXECUTE ON FUNCTION public.log_user_login(p_pseudo text) FROM PUBLIC;
  RAISE NOTICE '✅ log_user_login(): EXECUTE révoqué pour anon + authenticated + PUBLIC';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️ log_user_login(): %', SQLERRM;
END $$;

-- ============================================================================
-- 2. FIX : use_user_code() — SECURITY DEFINER accessible publiquement (CRITIQUE)
--    Risque: N'importe qui peut activer des codes d'accès sans passer par l'app
--    Contexte: L'app utilise /api/admin-codes (Vercel + service_role)
--    Correction: Révoquer EXECUTE pour anon et authenticated
-- ============================================================================
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.use_user_code(p_code text, p_pseudo text) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.use_user_code(p_code text, p_pseudo text) FROM authenticated;
  REVOKE EXECUTE ON FUNCTION public.use_user_code(p_code text, p_pseudo text) FROM PUBLIC;
  RAISE NOTICE '✅ use_user_code(): EXECUTE révoqué pour anon + authenticated + PUBLIC';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️ use_user_code(): %', SQLERRM;
END $$;

-- ============================================================================
-- 3. FIX : verify_credentials() — SECURITY DEFINER accessible (CRITIQUE)
--    Risque: N'importe qui connecté peut vérifier des mots de passe
--    Contexte: L'app utilise /api/admin-login (Vercel + service_role)
--    Correction: Révoquer EXECUTE pour authenticated
-- ============================================================================
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.verify_credentials(p_pseudo text, p_password text) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.verify_credentials(p_pseudo text, p_password text) FROM authenticated;
  RAISE NOTICE '✅ verify_credentials(): EXECUTE révoqué pour anon + authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️ verify_credentials(): %', SQLERRM;
END $$;

-- ============================================================================
-- 4. FIX : check_premium_status() — SECURITY DEFINER accessible (MOYEN)
--    Risque: Un utilisateur connecté peut vérifier le premium de n'importe quel device
--    Contexte: L'app utilise /api/check-premium (Vercel + service_role)
--    Correction: Révoquer EXECUTE pour authenticated (déjà révoqué pour anon normalement)
-- ============================================================================
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.check_premium_status(p_device_id text) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.check_premium_status(p_device_id text) FROM authenticated;
  RAISE NOTICE '✅ check_premium_status(): EXECUTE révoqué pour anon + authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️ check_premium_status(): %', SQLERRM;
END $$;

-- ============================================================================
-- 5. INFO : pg_net dans le schéma public
--    C'est l'extension utilisée par net.http_post() pour le cron auto-scrape
--    ⚠️ NE PAS déplacer ! La laisser dans public.schema pour que pg_cron
--    puisse utiliser net.http_post(). C'est un warning cosmétique sans risque.
--    Si on la déplace vers extensions, les jobs pg_cron cesseront de fonctionner.
-- ============================================================================

-- ============================================================================
-- VÉRIFICATION : Confirmer les révocations
-- ============================================================================
-- SELECT proname, proargtypes::regtype[], grantee::regrole, privilege_type
-- FROM pg_proc p
-- JOIN information_schema.role_routines r ON r.specific_name = p.proname
-- WHERE p.pronamespace = 'public'::regnamespace
-- AND p.prosecdef = true;
