-- ============================================
-- NETTOYER LES DOUBLONS ET CORRIGER LES CONFIANCES
-- ============================================

-- 1. Supprimer les doublons (garder le plus récent par match)
DELETE FROM predictions a
USING predictions b
WHERE a.id < b.id 
  AND a.home_team = b.home_team 
  AND a.away_team = b.away_team
  AND a.created_at < b.created_at;

-- 2. Corriger les confiances > 100 (diviser par 100)
UPDATE predictions 
SET confidence = confidence / 100 
WHERE confidence > 100;

-- 3. Vérifier les données corrigées
SELECT 
  id, 
  home_team, 
  away_team, 
  confidence, 
  status, 
  created_at 
FROM predictions 
ORDER BY created_at DESC 
LIMIT 10;
