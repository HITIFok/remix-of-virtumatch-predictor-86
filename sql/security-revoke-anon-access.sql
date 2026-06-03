-- ═══════════════════════════════════════════════════════════════════════════════
-- SQL DE RÉVOCATION — Sécuriser les fonctions Supabase
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- IMPORTANT : Exécuter ce script DANS L'ÉDITEUR SQL SUPABASE (SQL Editor)
-- après le déploiement des nouvelles API Routes Vercel.
--
-- Ce script :
-- 1. RÉVOQUE l'accès anon aux fonctions sensibles (SECURITY DEFINER)
-- 2. Les fonctions ne seront plus appelables que par service_role (via API Routes)
-- 3. Conserve l'accès anon aux fonctions publiques nécessaires
--
-- ⚠️  À EXÉCUTER EN UNE SEULE FOIS après confirmation que l'APK fonctionne
--     avec les nouvelles API Routes Vercel.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. RÉVOQUER l'accès anon aux fonctions CRITIQUES ───────────────────────────

-- verify_admin_password : vérification du mot de passe admin
-- RISQUE : brute-force du password admin par n'importe qui
-- Maintenant : uniquement accessible via /api/admin-login (service_role + rate limiting)
REVOKE EXECUTE ON FUNCTION public.verify_admin_password(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.verify_admin_password(text) FROM public;

-- admin_delete_access_code : suppression de codes premium
-- RISQUE : n'importe qui peut supprimer des codes premium
-- Maintenant : uniquement accessible via /api/admin-delete-code (vérifie token HMAC admin)
REVOKE EXECUTE ON FUNCTION public.admin_delete_access_code(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_access_code(uuid) FROM public;

-- ─── 2. RÉVOQUER l'accès anon aux fonctions MODÉRÉES ────────────────────────────

-- check_premium_status : vérifie le statut premium d'un device
-- RISQUE MODÉRÉ : énumération de device IDs
-- Maintenant : uniquement accessible via /api/check-premium (service_role)
REVOKE EXECUTE ON FUNCTION public.check_premium_status(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_premium_status(text) FROM public;

-- verify_credentials : vérifie un mot de passe haché (si existe)
-- RISQUE : brute-force de mots de passe utilisateurs
REVOKE EXECUTE ON FUNCTION public.verify_credentials(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.verify_credentials(text, text) FROM public;

-- ─── 3. CONSERVER l'accès anon aux fonctions PUBLIQUES ──────────────────────────
-- (Ne pas révoquer ces fonctions — elles sont nécessaires pour les utilisateurs)

-- use_user_code : activation d'un code premium par un utilisateur
-- log_user_login : logging des connexions
-- Ces fonctions sont déjà protégées par RLS sur les tables sous-jacentes

-- ─── 4. VÉRIFICATION — Confirmer les permissions ─────────────────────────────────

-- Pour vérifier que les révocations ont fonctionné, exécuter :
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.role_routine_grants
-- WHERE routine_schema = 'public'
-- AND grantee IN ('anon', 'authenticated', 'public')
-- ORDER BY routine_name, grantee;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN DU SCRIPT
-- ═══════════════════════════════════════════════════════════════════════════════
