-- Script pour mettre à jour le mot de passe admin dans Supabase
-- Exécutez ce script dans l'éditeur SQL de Supabase

-- Mettre à jour le mot de passe admin vers REDACTED
UPDATE admin_settings 
SET setting_value = 'REDACTED', updated_at = NOW()
WHERE setting_key = 'admin_code';

-- Vérifier que la mise à jour a été effectuée
SELECT * FROM admin_settings WHERE setting_key = 'admin_code';
