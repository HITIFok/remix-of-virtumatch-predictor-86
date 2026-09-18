# BACKTEST DATASET AUDIT

## Sources de données identifiées

| # | Source | Table/Fichier | Plage de dates | Nombre de matchs | Champs disponibles | Doublons | Valeurs manquantes |
|---|--------|--------------|----------------|-------------------|-------------------|----------|-------------------|
| 1 | **predictions** (Neon) | `predictions` | Variable (depuis déploiement) | Variable (count des status='correct'+'incorrect') | odds, probs, prediction, confidence, actual_outcome, actual_scores, timestamps | Partiel (`idx_predictions_unique_match_day` limite 1/jour/match) | `engine_version`, `engine_config`, `league_id`, `round` parfois NULL |
| 2 | **scraped_data** (Neon) | `scraped_data` (data_type='matches') | Variable | ~100-500 par ligue | home, away, round, odds, expectedStart, status | Upserté — seul dernier snapshot | Historical odds perdus |
| 3 | **scraped_data** (Neon) | `scraped_data` (data_type='ranking') | Variable | ~20 par ligue | position, team, played, won, drawn, lost, goalsFor, goalsAgainst | Upserté — seul dernier snapshot | Historical ranking perdus |
| 4 | **scraped_data** (Neon) | `scraped_data` (data_type='results') | Variable | ~100-500 par ligue | home, away, scoreHome, scoreAway, round | Upserté — seul dernier snapshot | N/A |
| 5 | **match_results** (Neon) | `match_results` | Variable | Variable | league_id, round, match_id, scores, goals timeline | Unique (league_id, round, match_id) | Seulement playout (pas tous les matchs) |
| 6 | **prediction_stats** (Neon) | `prediction_stats` | Variable | 1 par jour | Aggrégats quotidiens | Unique (date) | Données agrégées uniquement |
| 7 | **API externe** | `hg-event-api-prod.sporty-tech.net` | Temps réel | Toutes les ligues | matches, results, ranking | N/A | Pas persisté localement |

## Champs critiques pour le backtest

### ✅ Disponibles dans la table `predictions`
- `odd_home`, `odd_draw`, `odd_away` — cotes au moment de la prédiction
- `prob_home`, `prob_draw`, `prob_away` — probabilités calculées
- `prediction` — résultat prédit (1/X/2)
- `confidence` — confiance (0-100)
- `predicted_home_score`, `predicted_away_score` — score prédit
- `actual_outcome` — résultat réel (1/X/2)
- `actual_home_score`, `actual_away_score` — score réel
- `status` — pending/correct/incorrect
- `created_at` — timestamp de prédiction
- `verified_at` — timestamp de vérification

### ❌ Manquants (gap critique)
- `engine_version` — version du moteur ayant produit la prédiction
- `engine_config` — snapshot des coefficients utilisés
- `feature_snapshot` — données d'entrée (ranking, form, H2H)
- `lambda_home`, `lambda_away` — valeurs λ Poisson
- `score_matrix` — matrice de probabilités des scores
- `ai_prediction` — prédiction IA séparée du math
- `model_version`, `feature_version`, `config_version`

## Impact sur la validité du backtest

1. **Sans `engine_version`** : Impossible de savoir quel moteur a produit quelle prédiction. Si le moteur change entre deux périodes, les résultats sont mélangés.

2. **Sans `feature_snapshot`** : Impossible de rejouer une prédiction avec les mêmes données d'entrée. Le backtest ne peut utiliser que les cotes stockées (ce qui équivaut à un modèle odds-only).

3. **Sans `engine_config`** : Impossible de savoir quels coefficients étaient actifs. Les comparaisons avant/après un changement de coefficient sont invalides.

4. **`scraped_data` upserté** : Les snapshots historiques sont perdus. Impossible de reconstruire l'état du ranking/form au moment de la prédiction.

## Recommandation

**Pour un backtest scientifiquement valide avec les données actuelles :**

1. Utiliser UNIQUEMENT les prédictions vérifiées (`status IN ('correct', 'incorrect')`)
2. Les cotes stockées sont fiables (capturées au moment de la prédiction)
3. Les résultats réels sont fiables (vérifiés par verify-predictions.js via API externe)
4. Mais : **les features (form, H2H, stats, AI) ne peuvent PAS être reconstruites**
5. Conséquence : le backtest actuel ne peut mesurer que la performance du modèle **odds-only**
6. Pour mesurer l'impact des features, il faut soit :
   a. Ajouter `feature_snapshot` aux futures prédictions
   b. Ou rejouer le moteur avec les features disponibles au moment de la prédiction

**Statut du dataset : PARTIELLEMENT UTILISABLE**
- Prédictions + résultats : ✅ 
- Features au moment de la prédiction : ❌ 
- Version du moteur : ❌ 
