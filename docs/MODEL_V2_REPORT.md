# MODEL V2 REPORT — VirtuMatch

**Date**: 2026-09-17  
**Statut**: FRAMEWORK DÉFINI — résultats en attente d'exécution  
**Basé sur**: BACKTEST_FRAMEWORK.md + CURRENT_STATE_AUDIT.md

---

## 1. ÉTAT ACTUEL DU MODÈLE

### Version actuelle : poisson-v4 (non calibrée)

| Attribut | Valeur |
|----------|--------|
| Pipeline | 13 steps (odds → Poisson → stats → form → H2H → matrix → AI → virtual → trap → HT → markets → confidence) |
| Coefficients | 22 (config) + ~30 (hardcoded) |
| Coefficients validés | **0 / 22** |
| Calibration | **Aucune** |
| Walk-forward test | **Aucun** |
| Data leakage test | **Aucun** |
| AI improvement evidence | **Aucune** |
| Baseline comparison | **Aucune** |

### Constats critiques

1. **On ne sait PAS si le modèle est meilleur que les cotes implicites** — la baseline la plus simple
2. **On ne sait PAS si l'IA améliore le modèle** — AI_WEIGHT = 0.35 est arbitraire
3. **On ne sait PAS si la confidence est calibrée** — "82%" ne signifie pas "82% de probabilité"
4. **On ne sait PAS s'il y a du data leakage** — aucune garde contre l'utilisation de données futures

---

## 2. RÉSULTATS ATTENDUS (framework défini, non exécuté)

### Table de comparaison (TEMPLATE)

| Model | Brier Score | Log Loss | ECE | Accuracy | Calibration |
|-------|-------------|----------|-----|----------|-------------|
| Baseline A (majority) | — | — | — | — | — |
| Baseline B (implied odds) | — | — | — | — | — |
| Baseline C (Poisson raw) | — | — | — | — | — |
| Model D (current) | — | — | — | — | Non calibré |
| Model E (sans H2H) | — | — | — | — | — |
| Model F (sans form) | — | — | — | — | — |
| Model G (sans momentum) | — | — | — | — | — |
| Model H (sans trap) | — | — | — | — | — |
| Model I (sans AI) | — | — | — | — | — |
| Model J (optimized) | — | — | — | — | — |
| Model K (opt + AI) | — | — | — | — | — |

### Analyse d'ablation (TEMPLATE)

| Feature retirée | Δ Brier Score | Δ Log Loss | Verdict |
|----------------|---------------|------------|---------|
| H2H | — | — | Améliore / Dégrade / Neutre |
| Form | — | — | — |
| Momentum | — | — | — |
| Trap detection | — | — | — |
| AI | — | — | — |

### AI_WEIGHT optimal (TEMPLATE)

| AI_WEIGHT | Brier (TRAIN) | Brier (TEST) | LogLoss (TEST) | ECE (TEST) |
|-----------|---------------|--------------|----------------|------------|
| 0.00 | — | — | — | — |
| 0.05 | — | — | — | — |
| 0.10 | — | — | — | — |
| 0.15 | — | — | — | — |
| 0.20 | — | — | — | — |
| 0.25 | — | — | — | — |
| 0.30 | — | — | — | — |
| 0.35 (current) | — | — | — | — |
| 0.40 | — | — | — | — |
| 0.45 | — | — | — | — |
| 0.50 | — | — | — | — |

**AI_WEIGHT optimal (sur TRAIN)** : —  
**AI_WEIGHT validé (sur TEST)** : —  
**Conclusion AI** : —

### Calibration (TEMPLATE)

| Méthode | ECE avant | ECE après (TRAIN) | ECE après (TEST) | Overfitting ? |
|---------|-----------|-------------------|------------------|---------------|
| Platt Scaling | — | — | — | — |
| Isotonic Regression | — | — | — | — |
| Beta Calibration | — | — | — | — |

**Méthode sélectionnée** : —  
**Amélioration ECE** : — → —

### Coefficients optimisés (TEMPLATE)

| Coefficient | Valeur actuelle | Valeur optimisée (TRAIN) | Δ |
|-------------|----------------|--------------------------|---|
| VIRTUAL_AVG_GOALS | 1.3 | — | — |
| AI_WEIGHT | 0.35 | — | — |
| FORM_ATTACK_BOOST | 0.15 | — | — |
| H2H_HOME_BOOST | 0.5 | — | — |
| CONF_CAP | 82 | — | — |

### VIRTUAL_AVG_GOALS (TEMPLATE)

| Fenêtre temporelle | Moyenne goals | Variance | Draw rate |
|--------------------|---------------|----------|-----------|
| 10 matchs | — | — | — |
| 25 matchs | — | — | — |
| 50 matchs | — | — | — |
| 100 matchs | — | — | — |
| 250 matchs | — | — | — |
| 500 matchs | — | — | — |

**VIRTUAL_AVG_GOALS optimal** : — (validé sur TEST)

### Poisson vs alternatives (TEMPLATE)

| Model | Brier | LogLoss | P(0-0) pred | P(0-0) actual | χ² p-value |
|-------|-------|---------|-------------|---------------|------------|
| Poisson (current) | — | — | — | — | — |
| Dixon-Coles | — | — | — | — | — |
| Bivariate Poisson | — | — | — | — | — |
| Empirical | — | — | — | — | — |

**Overdispersion détectée** : —  
**Zero-inflation détectée** : —  
**Home/Away dépendance** : —

---

## 3. RECOMMANDATIONS PRÉLIMINAIRES

Basées sur l'audit du code actuel, SANS exécution du backtest :

### Haute probabilité

1. **VIRTUAL_AVG_GOALS = 1.3 est probablement sous-estimé** — Le football virtuel a souvent plus de buts que le football réel. La calibration empirique est PRIORITY 1.
2. **AI_WEIGHT = 0.35 est probablement trop élevé** — 35% de poids sur un LLM (Groq) qui n'a pas été entraîné sur le football virtuel est agressif. L'ablation study déterminera la valeur optimale.
3. **Le cross-term STAT_DEF_WEIGHT double-compte** — Le grid search encode déjà la relation λH/λA. Le cross-term `(λA × defenseWeakness) × 0.10` ajoute de l'information redondante.

### Moyenne probabilité

4. **Les trap signals améliorent probablement le modèle** — Ils pénalisent la confidence dans les cas ambigus, ce qui améliore la calibration (moins de faux haute confiance).
5. **Le score matrix 7×7 est probablement insuffisant** — Pour des λ élevés (favoris avec beaucoup de buts), la probabilité au-delà de 6 goals n'est pas négligeable. Passer à 8×8 ou 9×9.

### Faible probabilité (nécessite validation)

6. **Dixon-Coles améliorera probablement les draws** — La correction τ ajuste P(0-0), P(1-0), P(0-1), P(1-1). Si le football virtuel a plus de 0-0 que prédit par Poisson, Dixon-Coles aidera.
7. **La calibration Isotonic sera probablement meilleure que Platt** — Isotonic est plus flexible et peut capturer les non-linéarités dans la relation confidence → accuracy.

---

## 4. ACTIONS REQUISES

### Avant toute déclaration de performance

1. ❌ **Construire le dataset de backtest** — Données historiques avec timestamps
2. ❌ **Implémenter les tests anti-data-leakage** — Garantir que les features n'utilisent pas le futur
3. ❌ **Exécuter le walk-forward** — TRAIN/TEST split temporel
4. ❌ **Calculer toutes les métriques** — Brier, LogLoss, ECE, Accuracy, Calibration
5. ❌ **Comparer les baselines** — Majority, Implied Odds, Poisson Raw
6. ❌ **Ablation study** — Form, H2H, Momentum, AI, Trap
7. ❌ **Calibration** — Platt, Isotonic, Beta sur TRAIN, validé sur TEST
8. ❌ **Coefficient optimization** — Grid search / Bayesian sur TRAIN

### Après validation

9. ⬜ Mettre à jour les coefficients dans `prediction-config.ts`
10. ⬜ Implémenter la calibration dans le pipeline
11. ⬜ Ajouter MODEL_VERSION aux prédictions stockées
12. ⬜ Refactorer `prediction-engine.ts` en modules
13. ⬜ Implémenter Dixon-Coles si amélioration confirmée

---

## 5. MODEL VERSIONING

### Version courante

```typescript
export const MODEL_VERSION = {
  model: 'poisson-v4',
  features: 'features-v3',
  calibration: 'uncalibrated',
  config: 'config-v1-22coeff',
  engine: 'prediction-engine-1351loc',
};
```

### Version cible (après backtest + calibration)

```typescript
export const MODEL_VERSION_V2 = {
  model: 'poisson-dixon-coles-v5',    // Si Dixon-Coles améliore
  features: 'features-v4-optimized',   // Coefficients calibrés
  calibration: 'isotonic-v1',          // Méthode sélectionnée par validation
  config: 'config-v2-optimized',       // Coefficients optimisés
  engine: 'prediction-engine-refactored', // Modules séparés
};
```

Chaque prédiction stockée dans la table `predictions` doit inclure :

```sql
ALTER TABLE predictions ADD COLUMN model_version TEXT DEFAULT 'poisson-v4';
ALTER TABLE predictions ADD COLUMN feature_version TEXT DEFAULT 'features-v3';
ALTER TABLE predictions ADD COLUMN calibration_version TEXT DEFAULT 'uncalibrated';
```

---

*RAPPEL : Aucune métrique dans ce rapport n'est remplie. Ce rapport définit le framework et les templates. Les résultats réels nécessitent l'exécution du backtest walk-forward, qui est estimée à ~28h de travail.*
