# Plan de Remédiation V3 — VirtuMatch Predictor

**Date :** 2026-03-05
**Horizon :** 0–16 semaines
**Objectif :** Corriger les vulnérabilités critiques, valider le modèle et établir une infrastructure de backtest/calibration.
**Version :** 3.0 (approfondie)

---

## 0. Sommaire exécutif

Ce plan de remédiation adresse **20 correctifs** répartis en **5 niveaux de priorité** (P0–P4), couvrant la sécurité (HMAC, injection SQL), la validation empirique (backtest, calibration, ablation), l'optimisation des coefficients, et l'architecture. Chaque correctif est spécifié avec : ID unique, priorité, description détaillée, fichiers affectés, effort estimé, dépendances, méthode de vérification, et risque si non effectué.

---

## P0 — Sécurité Critique (0–7 jours)

### FIX-V3-01 : Vérifier HMAC_ONLY en production

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-01 |
| **Priorité** | P0 — Critique |
| **Description** | Vérifier que la variable d'environnement `HMAC_ONLY=true` est définie dans l'environnement de production Vercel. Sans cette variable, le système accepte des tokens JWT non signés, permettant l'usurpation d'identité. |
| **Fichiers affectés** | `.env.production`, `middleware.ts`, `vercel.json` |
| **Effort** | 1 heure |
| **Dépendances** | Aucune |
| **Vérification** | 1) Vérifier `process.env.HMAC_ONLY === 'true'` en production. 2) Tenter un appel API avec un token JWT non HMAC → doit être rejeté (401). 3) Audit des logs : aucun token JWT accepté en production. |
| **Risque si non fait** | **CRITIQUE** — N'importe quel utilisateur peut usurper l'identité de n'importe quel autre utilisateur en forgeant un JWT. Faille de sécurité majeure. |
| **Rollback** | Si `HMAC_ONLY=true` cause des problèmes, revenir à `HMAC_ONLY=false` en urgence tout en investiguant. Documenter les tokens affectés. |

### FIX-V3-02 : Étendre la signature HMAC

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-02 |
| **Priorité** | P0 — Critique |
| **Description** | La signature HMAC actuelle ne couvre que le payload. Elle doit être étendue pour inclure `method:path:bodyHash:nonce`, empêchant les attaques par rejeu et par modification de la requête. |
| **Fichiers affectés** | `lib/auth/hmac.ts`, `middleware.ts`, `app/api/*/route.ts` |
| **Effort** | 4 heures |
| **Dépendances** | FIX-V3-01 |
| **Vérification** | 1) Test unitaire : signature change si method change (GET → POST). 2) Test unitaire : signature change si path change (/api/a → /api/b). 3) Test unitaire : signature change si body change. 4) Test : rejeter une requête avec une signature pour un autre path. |
| **Risque si non fait** | **CRITIQUE** — Un attaquant peut rejeu une requête valide (même signature, effet répété) ou modifier le path d'une requête signée. |
| **Rollback** | Désactiver la vérification étendue temporairement. Maintenir la vérification HMAC de base (payload uniquement). |

### FIX-V3-03 : Ajouter un mécanisme de nonce

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-03 |
| **Priorité** | P0 — Critique |
| **Description** | Implémenter un mécanisme de nonce (nombre utilisé une fois) pour les tokens HMAC. Chaque token inclut un nonce unique ; le serveur maintient un cache des nonces récents et rejette tout token avec un nonce déjà vu. |
| **Fichiers affectés** | `lib/auth/hmac.ts`, `lib/auth/nonce-store.ts`, `middleware.ts` |
| **Effort** | 4 heures |
| **Dépendances** | FIX-V3-02 |
| **Vérification** | 1) Test : soumettre le même token deux fois → la deuxième requête est rejetée (401). 2) Test : soumettre deux tokens avec des nonces différents → les deux sont acceptés. 3) Vérifier que le cache de nonces expire après une durée configurée (ex: 5 minutes). |
| **Risque si non fait** | **ÉLEVÉ** — Sans nonce, un attaquant peut capturer une requête valide et la rejouer indéfiniment (replay attack). |
| **Rollback** | Désactiver la vérification de nonce. Le mécanisme HMAC de base reste actif. |

### FIX-V3-04 : Corriger l'injection SQL

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-04 |
| **Priorité** | P0 — Critique |
| **Description** | La fonction `generateDeletionSQL()` construit des requêtes SQL par concaténation de chaînes, permettant l'injection SQL. Remplacer par des requêtes paramétrées (prepared statements). |
| **Fichiers affectés** | `lib/db/generate-deletion-sql.ts`, `app/api/admin/delete/route.ts` |
| **Effort** | 2 heures |
| **Dépendances** | Aucune |
| **Vérification** | 1) Test avec input malveillant : `'; DROP TABLE users; --` → la requête ne doit pas exécuter DROP TABLE. 2) Code review : aucune concaténation de chaînes dans les requêtes SQL. 3) Vérifier que tous les paramètres sont passés via le mécanisme de paramétrisation du driver SQL. |
| **Risque si non fait** | **CRITIQUE** — Un attaquant peut exécuter des requêtes SQL arbitraires sur la base de données, permettant la lecture, modification ou suppression de toutes les données. |
| **Rollback** | Revenir à la version précédente de `generateDeletionSQL()` en désactivant l'endpoint admin temporairement. |

---

## P1 — Fuite de Données & Validation (1–4 semaines)

### FIX-V3-05 : Framework de backtest walk-forward

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-05 |
| **Priorité** | P1 — Critique |
| **Description** | Implémenter un framework de backtest walk-forward complet avec : (1) génération automatique des fenêtres temporelles (train/validation/test), (2) vérification automatique de l'absence de fuite future, (3) calcul des métriques par fenêtre et agrégées, (4) stockage des prédictions avec model_version pour reproductibilité. |
| **Fichiers affectés** | Nouveau : `lib/backtest/walk-forward.ts`, `lib/backtest/window-generator.ts`, `lib/backtest/leak-detector.ts`, `lib/backtest/metrics.ts`, `scripts/run-backtest.ts` |
| **Effort** | 3 semaines |
| **Dépendances** | Aucune |
| **Vérification** | 1) Backtest sur données historiques connues (saisons 2020-2024). 2) Métriques OOS cohérentes entre fenêtres. 3) Aucune fuite future détectée par le leak-detector. 4) Chaque prédiction a un model_version. 5) Comparaison avec baseline cotes → résultat plausible. |
| **Risque si non fait** | **CRITIQUE** — Sans backtest walk-forward, le modèle n'est pas validé. Tous les autres correctifs de validation (calibration, ablation, coefficients) dépendent de ce framework. C'est le **prérequis de toute validation empirique**. |
| **Rollback** | Supprimer le module backtest. Le modèle continue à fonctionner sans validation (état actuel). |

### FIX-V3-06 : Calculer les métriques de calibration

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-06 |
| **Priorité** | P1 — Critique |
| **Description** | Extraire les prédictions vérifiées de la base Neon DB, calculer ECE (10 bins), MCE, Brier Score (avec décomposition de Murphy), Log Loss, et produire un diagramme de fiabilité. |
| **Fichiers affectés** | Nouveau : `lib/calibration/metrics.ts`, `lib/calibration/reliability-diagram.ts`, `scripts/compute-calibration.ts` |
| **Effort** | 1 semaine |
| **Dépendances** | FIX-V3-05 (backtest walk-forward pour split temporel) |
| **Vérification** | 1) ECE, MCE, Brier, Log Loss sont des nombres finis et positifs. 2) 0 ≤ ECE ≤ 1. 3) ECE ≤ MCE. 4) Diagramme de fiabilité produit (format PNG/SVG). 5) Si bien calibré : ECE < 0.10. |
| **Risque si non fait** | **ÉLEVÉ** — Sans métriques de calibration, les scores de confiance restent décoratifs. L'utilisateur est trompé. |
| **Rollback** | Supprimer le module de calibration. Les scores de confiance restent heuristiques (état actuel). |

### FIX-V3-07 : Valider VIRTUAL_AVG_GOALS empiriquement

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-07 |
| **Priorité** | P1 — Élevé |
| **Description** | Remplacer les valeurs arbitraires `VIRTUAL_AVG_GOALS = 1.3`, `DEFAULT_AVG_SCORED = 1.3`, `DEFAULT_AVG_CONCEDED = 1.1` par les moyennes historiques réelles par ligue et par saison, extraites de la base de données. |
| **Fichiers affectés** | `prediction-config.ts`, Nouveau : `lib/stats/league-averages.ts` |
| **Effort** | 3 jours |
| **Dépendances** | FIX-V3-05 (backtest pour validation) |
| **Vérification** | 1) Les valeurs remplacées correspondent aux moyennes historiques (±5%). 2) Backtest : performance OOS avec nouvelles valeurs ≥ performance OOS avec anciennes valeurs. 3) Documenter les valeurs par ligue dans un tableau. |
| **Risque si non fait** | **MOYEN** — Les valeurs par défaut sont potentiellement biaisées (1.3 buts/match vs 1.5 en Premier League vs 1.1 en Ligue 1). |
| **Rollback** | Restaurer les valeurs arbitraires (1.3, 1.3, 1.1). |

### FIX-V3-08 : Auditer historicalResults pour fuite same-round

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-08 |
| **Priorité** | P1 — Élevé |
| **Description** | Vérifier que les données `historicalResults` utilisées pour calculer les features ne contiennent aucun résultat d'un match de la même journée (same-round leakage). Si un match de la journée est terminé avant la prédiction, ses résultats ne doivent PAS être utilisés pour prédire d'autres matchs de la même journée (car l'utilisateur n'aurait pas cette information au moment de parier). |
| **Fichiers affectés** | `lib/data/historical-results.ts`, `prediction-engine.ts` |
| **Effort** | 1 semaine |
| **Dépendances** | Aucune |
| **Vérification** | 1) Pour chaque prédiction, vérifier qu'aucun résultat de la même journée n'est inclus dans les features. 2) Test automatisé : simuler une prédiction pour un match après qu'un autre match de la même journée est terminé → l'historique ne doit pas inclure ce résultat. 3) Audit manuel sur 100 matchs aléatoires. |
| **Risque si non fait** | **ÉLEVÉ** — Fuite de données same-round → les métriques de backtest sont optimistes. Le modèle « voit » des résultats qu'il ne devrait pas voir. |
| **Rollback** | Désactiver l'utilisation de historicalResults pour les features. Retomber sur les statistiques pré-saison uniquement. |

---

## P2 — Backtest & Calibration (2–8 semaines)

### FIX-V3-09 : Construire les 10 baselines

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-09 |
| **Priorité** | P2 — Élevé |
| **Description** | Implémenter les 10 baselines de comparaison : (1) Majorité, (2) Cotes brutes, (3) Cotes normalisées, (4) Poisson simple, (5) VirtuMatch complet, (6-10) 5 variantes d'ablation. Calculer Accuracy, Log Loss, Brier, ECE pour chaque modèle sur les données de test du backtest walk-forward. |
| **Fichiers affectés** | Nouveau : `lib/baselines/majority.ts`, `lib/baselines/odds-raw.ts`, `lib/baselines/odds-normalized.ts`, `lib/baselines/poisson-simple.ts`, `lib/baselines/comparison-table.ts` |
| **Effort** | 2 semaines |
| **Dépendances** | FIX-V3-05 (backtest walk-forward) |
| **Vérification** | 1) Tableau comparatif produit avec 10 lignes × 4 métriques. 2) Cotes normalisées battent la baseline majorité. 3) Poisson simple batte la baseline majorité. 4) Toutes les métriques sont calculées OOS uniquement. |
| **Risque si non fait** | **ÉLEVÉ** — Sans baselines, impossible de savoir si VirtuMatch apporte une valeur ajoutée. |
| **Rollback** | Supprimer le module de baselines. |

### FIX-V3-10 : Étude d'ablation complète

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-10 |
| **Priorité** | P2 — Élevé |
| **Description** | Implémenter l'étude d'ablation complète : retirer chaque composant (IA, H2H, Form, Momentum, Anti-trap, Stats) et mesurer la perte de performance OOS. Tester les interactions (leave-one-in, paires). Appliquer les tests de significativité (McNemar, DM, bootstrap). |
| **Fichiers affectés** | Nouveau : `lib/ablation/study.ts`, `lib/ablation/variants.ts`, `lib/ablation/significance.ts` |
| **Effort** | 2 semaines |
| **Dépendances** | FIX-V3-05 (backtest), FIX-V3-09 (baselines) |
| **Vérification** | 1) 7 configurations × N fenêtres évaluées. 2) Résultats de significativité pour chaque paire. 3) Momentum ne devrait pas ajouter de signal au-delà de Form (Δ ≈ 0). 4) H2H pourrait être nuisible (Δ < 0). |
| **Risque si non fait** | **ÉLEVÉ** — On ne sait pas quels composants ajoutent du signal vs du bruit. Le modèle reste une boîte noire. |
| **Rollback** | Supprimer le module d'ablation. Le modèle complet reste en production. |

### FIX-V3-11 : Appliquer les méthodes de calibration

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-11 |
| **Priorité** | P2 — Élevé |
| **Description** | Implémenter Temperature Scaling, Platt Scaling et régression isotonique. Ajuster sur VALIDATION uniquement. Évaluer ECE avant/après calibration sur TEST. Rapporter les résultats dans un tableau comparatif. |
| **Fichiers affectés** | Nouveau : `lib/calibration/platt-scaling.ts`, `lib/calibration/isotonic-regression.ts`, `lib/calibration/temperature-scaling.ts` |
| **Effort** | 1 semaine |
| **Dépendances** | FIX-V3-06 (métriques de calibration) |
| **Vérification** | 1) ECE après calibration < ECE avant calibration. 2) Calibration ajustée sur VALIDATION uniquement (pas TEST). 3) Les probabilités calibrées somment à 1.0 (±0.001). 4) Diagrammes de fiabilité avant/après produits. |
| **Risque si non fait** | **MOYEN** — Les scores de confiance restent non calibrés. L'utilisateur interprète la confiance comme une probabilité. |
| **Rollback** | Supprimer les méthodes de calibration. Utiliser les scores bruts (non calibrés). |

### FIX-V3-12 : Diagrammes de fiabilité

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-12 |
| **Priorité** | P2 — Moyen |
| **Description** | Produire des diagrammes de fiabilité (reliability diagrams) par décile, avant et après chaque méthode de calibration. Format PNG/SVG pour inclusion dans les rapports. |
| **Fichiers affectés** | Nouveau : `lib/calibration/reliability-diagram.ts`, `scripts/generate-diagrams.ts` |
| **Effort** | 1 semaine |
| **Dépendances** | FIX-V3-11 (méthodes de calibration) |
| **Vérification** | 1) Diagrammes produits (format PNG). 2) Points proches de la diagonale après calibration. 3) 10 bins par diagramme. 4) Barres d'erreur (Wilson intervals) sur chaque point. |
| **Risque si non fait** | **FAIBLE** — Pas de diagnostic visuel, mais les métriques numériques suffisent. |
| **Rollback** | Supprimer la génération de diagrammes. |

---

## P3 — Optimisation des Coefficients (4–12 semaines)

### FIX-V3-13 : Grid search sur TRAIN/VALIDATION

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-13 |
| **Priorité** | P3 — Élevé |
| **Description** | Optimiser les coefficients Tier 1 (AI_WEIGHT, VIRTUAL_AVG_GOALS, H2H_HOME_BOOST, H2H_AWAY_PENALTY, CONF_CAP, DEFAULT_AVG_SCORED, DEFAULT_AVG_CONCEDED) par grid search ou random search sur TRAIN/VALIDATION. **Jamais sur TEST.** |
| **Fichiers affectés** | `prediction-config.ts`, Nouveau : `lib/optimization/grid-search.ts`, `lib/optimization/random-search.ts`, `scripts/optimize-coefficients.ts` |
| **Effort** | 2 semaines |
| **Dépendances** | FIX-V3-05 (backtest walk-forward) |
| **Vérification** | 1) Coefficients optimisés différents des valeurs arbitraires. 2) Performance OOS sur TEST ≥ performance avec coefficients arbitraires. 3) Aucune donnée de TEST utilisée pour l'optimisation. 4) Documenter les valeurs avant/après. |
| **Risque si non fait** | **ÉLEVÉ** — Les coefficients restent arbitraires. Le modèle est potentiellement sous-optimal. |
| **Rollback** | Restaurer les coefficients arbitraires originaux. |

### FIX-V3-14 : Éliminer le double comptage Momentum ↔ Form

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-14 |
| **Priorité** | P3 — Élevé |
| **Description** | Supprimer le composant Momentum de la formule de confiance car il est redondant avec Form par construction (Momentum = f(Form)). Alternatives : (A) Supprimer Momentum entièrement, (B) Fusionner Form+Momentum en un seul composant, (C) Supprimer Form et garder Momentum. Recommandation : Option A. |
| **Fichiers affectés** | `prediction-engine.ts`, `prediction-config.ts` |
| **Effort** | 1 semaine |
| **Dépendances** | FIX-V3-10 (ablation pour confirmer la redondance) |
| **Vérification** | 1) Ablation : retirer Momentum ne change pas la performance (Δ < seuil de significativité). 2) Le code ne contient plus de référence à Momentum dans le calcul de confiance. 3) Backtest OOS : performance sans Momentum ≥ performance avec Momentum. |
| **Risque si non fait** | **MOYEN** — Le double comptage persiste. La forme récente est sur-représentée dans le modèle. |
| **Rollback** | Rétablir Momentum dans la formule de confiance avec `MOMENTUM_WEIGHT = 0.20`. |

### FIX-V3-15 : Unifier les coefficients serveur/client

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-15 |
| **Priorité** | P3 — Moyen |
| **Description** | Créer un registre centralisé des coefficients qui est l'unique source de vérité, partagée entre serveur et client. Actuellement, les coefficients peuvent diverger entre `prediction-config.ts` (serveur) et le code client. |
| **Fichiers affectés** | `prediction-config.ts`, `app/prediction/config.ts`, Nouveau : `lib/config/centralized-registry.ts` |
| **Effort** | 1 semaine |
| **Dépendances** | Aucune |
| **Vérification** | 1) Un seul fichier source de vérité. 2) Test de non-divergence : coefficients serveur === coefficients client. 3) CI : le test de non-divergence tourne à chaque PR. |
| **Risque si non fait** | **MOYEN** — Divergence silencieuse entre coefficients serveur et client. Prédictions incohérentes. |
| **Rollback** | Revenir aux fichiers séparés (serveur + client). |

### FIX-V3-16 : Gardes NaN / Infinity

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-16 |
| **Priorité** | P3 — Moyen |
| **Description** | Ajouter des gardes NaN/Infinity sur tous les calculs du moteur de prédiction. Division par zéro, logarithme de zéro, racine de négatif, etc. |
| **Fichiers affectés** | `prediction-engine.ts`, `prediction-config.ts`, `lib/poisson/calculator.ts` |
| **Effort** | 3 jours |
| **Dépendances** | Aucune |
| **Vérification** | 1) Test avec inputs extrêmes (0 buts, 100 buts, équipe sans historique, cotes = 0). 2) Aucun NaN ou Infinity en sortie. 3) Les valeurs par défaut sont utilisées quand les données sont insuffisantes. |
| **Risque si non fait** | **MOYEN** — Crash silencieux ou valeurs NaN propagées dans les calculs. |
| **Rollback** | Supprimer les gardes. Les calculs peuvent produire NaN/Infinity en cas d'input extrême. |

---

## P4 — Architecture & Performance (8–16 semaines)

### FIX-V3-17 : Refactorer le moteur de prédiction

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-17 |
| **Priorité** | P4 — Moyen |
| **Description** | Refactorer `prediction-engine.ts` en pipeline modulaire : chaque composant (IA, H2H, Form, Stats, Anti-trap) est un module indépendant avec une interface standardisée. Cela facilite l'ablation, les tests unitaires, et l'ajout de nouveaux composants. |
| **Fichiers affectés** | `prediction-engine.ts`, Nouveau : `lib/predictors/ai.ts`, `lib/predictors/h2h.ts`, `lib/predictors/form.ts`, `lib/predictors/stats.ts`, `lib/predictors/anti-trap.ts`, `lib/predictors/pipeline.ts` |
| **Effort** | 2 semaines |
| **Dépendances** | FIX-V3-14 (suppression Momentum pour simplifier) |
| **Vérification** | 1) Chaque module testable indépendamment. 2) Pipeline produit les mêmes résultats que l'ancien moteur (test de non-régression). 3) Ajout/suppression d'un composant ne nécessite qu'une ligne de code. |
| **Risque si non fait** | **FAIBLE** — Le code reste monolithique. Difficile à maintenir et à tester. |
| **Rollback** | Revenir à l'architecture monolithique. |

### FIX-V3-18 : Versionnage du modèle

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-18 |
| **Priorité** | P4 — Moyen |
| **Description** | Ajouter un `modelVersion` à chaque prédiction persistée. Cela permet la reproductibilité, la comparaison entre versions, et le rollback en production. |
| **Fichiers affectés** | `prediction-engine.ts`, Schéma DB : `predictions` table |
| **Effort** | 1 semaine |
| **Dépendances** | FIX-V3-17 (pipeline modulaire) |
| **Vérification** | 1) Chaque prédiction a un `modelVersion` non null. 2) Deux prédictions avec le même `modelVersion` et les mêmes inputs produisent les mêmes outputs. 3) L'ancien modèle (v1) et le nouveau (v2) peuvent coexister dans la DB. |
| **Risque si non fait** | **FAIBLE** — Impossible de comparer les versions ou de rollback en cas de problème. |
| **Rollback** | Supprimer le champ modelVersion. |

### FIX-V3-19 : Cron de rétention GDPR

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-19 |
| **Priorité** | P4 — Faible |
| **Description** | Implémenter un cron job qui supprime automatiquement les données personnelles après la durée de rétention configurée (conformité GDPR). |
| **Fichiers affectés** | Nouveau : `lib/cron/gdpr-retention.ts`, `vercel.json` (cron config) |
| **Effort** | 1 semaine |
| **Dépendances** | Aucune |
| **Vérification** | 1) Données antérieures à la durée de rétention supprimées. 2) Données récentes conservées. 3) Log de suppression pour audit. |
| **Risque si non fait** | **FAIBLE** — Non-conformité GDPR potentielle. Risque juridique. |
| **Rollback** | Désactiver le cron. |

### FIX-V3-20 : Rotation automatique des secrets

| Champ | Valeur |
|---|---|
| **ID** | FIX-V3-20 |
| **Priorité** | P4 — Faible |
| **Description** | Automatiser la rotation des secrets (HMAC_KEY, DB_URL, etc.) via un mécanisme de rotation sans interruption de service. |
| **Fichiers affectés** | `.env.production`, Nouveau : `lib/secrets/rotation.ts` |
| **Effort** | 1 semaine |
| **Dépendances** | Aucune |
| **Vérification** | 1) Secrets rotés sans interruption de service. 2) Ancien secret invalide après rotation. 3) Nouveau secret fonctionnel. |
| **Risque si non fait** | **FAIBLE** — Secret compromis → pas de mécanisme de rotation rapide. |
| **Rollback** | Désactiver la rotation automatique. Rotation manuelle en cas de compromission. |

---

## Graphe de dépendances

```
FIX-V3-01 ──► FIX-V3-02 ──► FIX-V3-03

FIX-V3-05 ──┬──► FIX-V3-06 ──► FIX-V3-11 ──► FIX-V3-12
             ├──► FIX-V3-07
             ├──► FIX-V3-09 ──┐
             └──► FIX-V3-13   └──► FIX-V3-10 ──► FIX-V3-14 ──► FIX-V3-17 ──► FIX-V3-18

FIX-V3-04  (indépendant)
FIX-V3-08  (indépendant)
FIX-V3-15  (indépendant)
FIX-V3-16  (indépendant)
FIX-V3-19  (indépendant)
FIX-V3-20  (indépendant)
```

---

## Timeline (Gantt-like ASCII)

```
Semaine  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16
──────────────────────────────────────────────────────────
P0  ██  │      │      │      │      │      │      │
    01-04│      │      │      │      │      │      │
         │      │      │      │      │      │      │
P1       ████████──────│      │      │      │      │
    05   ██████████████│      │      │      │      │
    06            ██████│      │      │      │      │
    07          ███     │      │      │      │      │
    08       ██████████│      │      │      │      │
         │      │      │      │      │      │      │
P2              ████████████████────│      │      │
    09            ████████████│    │      │      │
    10                  ████████████│      │      │
    11                        ██████│      │      │
    12                            ██████  │      │
         │      │      │      │      │      │      │
P3                      ████████████████████──────│
    13                ████████████│      │      │
    14                      ██████████  │      │
    15                          ██████████    │
    16                      ███             │
         │      │      │      │      │      │      │
P4                                  ████████████████
    17                          ████████████│
    18                                ██████████
    19                            ██████████
    20                            ██████████
```

---

## Ressources requises

| Ressource | P0 | P1 | P2 | P3 | P4 | Total |
|---|---|---|---|---|---|---|
| Développeur principal | 11h | 4 sem | 6 sem | 5 sem | 5 sem | ~20 sem |
| Data scientist | — | 2 sem | 4 sem | 3 sem | — | ~9 sem |
| Relecteur sécurité | 11h | — | — | — | — | 11h |
| Infrastructure DB | — | 1 sem | 1 sem | — | — | 2 sem |
| Compute pour backtest | — | 20h GPU | 40h GPU | 20h GPU | — | 80h GPU |

---

## Critères de succès par phase

### Phase P0 (Sécurité)

- ✅ Aucun token JWT accepté en production.
- ✅ Aucune injection SQL possible sur les endpoints admin.
- ✅ Les nonces sont vérifiés pour chaque requête HMAC.

### Phase P1 (Validation)

- ✅ Backtest walk-forward produit des métriques OOS sur ≥ 3 fenêtres.
- ✅ ECE, Brier, Log Loss sont calculés et finis.
- ✅ VIRTUAL_AVG_GOALS correspond à la moyenne historique (±5%).
- ✅ Aucune fuite same-round détectée.

### Phase P2 (Calibration & Baselines)

- ✅ 10 baselines calculées avec métriques OOS.
- ✅ Tableau comparatif produit.
- ✅ ECE après calibration < ECE avant.
- ✅ Étude d'ablation complète (7 configurations × N fenêtres).
- ✅ Momentum confirmé redondant (Δ < seuil de significativité).

### Phase P3 (Optimisation)

- ✅ Coefficients Tier 1 optimisés sur VALIDATION.
- ✅ Momentum supprimé du modèle.
- ✅ Coefficients serveur/client unifiés.
- ✅ Aucun NaN/Infinity en sortie pour inputs extrêmes.

### Phase P4 (Architecture)

- ✅ Moteur de prédiction modulaire.
- ✅ Versionnage du modèle sur chaque prédiction.
- ✅ Cron GDPR fonctionnel.
- ✅ Rotation des secrets automatisée.

---

## Résumé

| Priorité | Délai | Nb. de fixes | Critique | Effort total |
|---|---|---|---|---|
| **P0** | 0–7 jours | 4 | Sécurité (HMAC, injection SQL) | ~11h |
| **P1** | 1–4 semaines | 4 | Fuite de données, validation empirique | ~6 semaines |
| **P2** | 2–8 semaines | 4 | Backtest, calibration, baselines | ~6 semaines |
| **P3** | 4–12 semaines | 4 | Optimisation coefficients, double comptage | ~5 semaines |
| **P4** | 8–16 semaines | 4 | Architecture, versionnage, GDPR, secrets | ~5 semaines |

**Total : 20 correctifs sur 16 semaines.**

---

## Prochaines étapes immédiates

1. **Cette semaine** : Exécuter FIX-V3-01 et FIX-V3-04 (sécurité critique, 3h total).
2. **Semaine prochaine** : Exécuter FIX-V3-02 et FIX-V3-03 (HMAC étendu + nonce, 8h total).
3. **Semaine 3** : Commencer FIX-V3-05 (framework walk-forward) — c'est le **prérequis de toute validation empirique**.

---

*Ce plan doit être mis à jour après chaque phase complétée. Les estimations d'effort sont des ordres de grandeur et doivent être affinées au début de chaque phase.*
