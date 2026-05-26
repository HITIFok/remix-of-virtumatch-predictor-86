-- Script pour mettre à jour le mot de passe admin dans Supabase
-- Exécutez ce script dans l'éditeur SQL de Supabase
-- Remplacez 'NOUVEAU_MOT_DE_PASSE' par le mot de passe souhaité

-- Enable pgcrypto if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Hasher le nouveau mot de passe avec bcrypt et le stocker
UPDATE admin_settings
SET setting_value = pgcrypto.crypt('REDACTED_SECRET', pgcrypto.gen_salt('bf')),
    updated_at = NOW()
WHERE setting_key = 'admin_code';

-- Vérifier que la mise à jour a été effectuée
SELECT setting_key,
       CASE WHEN setting_value LIKE '$2a$%' THEN 'Hash bcrypt stocké (sécurisé)' ELSE 'ATTENTION: mot de passe en clair!' END AS status
FROM admin_settings
WHERE setting_key = 'admin_code';
