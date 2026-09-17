# BACKTEST FRAMEWORK — VirtuMatch V2

**Date**: 2026-09-17  
**Objectif**: Framework walk-forward pour validation statistique du moteur de prédiction

---

## 1. ARCHITECTURE

### Walk-Forward Design

```
Historique ordonné par date
│
├── T=0 ──── TRAIN [t0 … tN] ──── TEST [tN+1 … tN+K]
│                                      ↓
│                              prediction(features_TN)
│                              vs résultat réel_TN+1
│                              → métriques cumulées
│
├── T=1 ──── TRAIN [t0 … tN+K] ──── TEST [tN+K+1 … tN+2K]
│                                       ↓
│                               prediction(features_TN+K)
│                               vs résultat réel_TN+K+1
│                               → métriques cumulées
│
└── … jusqu'à la fin du dataset
```

**Règle absolue** : Les features au temps T doivent utiliser UNIQUEMENT des données disponibles à T. Aucune donnée postérieure au match ne peut entrer dans une feature.

---

## 2. DATASET REQUIS

### Schéma

```typescript
interface BacktestMatch {
  // Identification
  match_id: string;
  home_team: string;
  away_team: string;
  league: string;
  round_number: number;
  
  // Temporel (CRITICAL pour anti-leakage)
  match_date: Date;         // Date/heure du match
  odds_date: Date;          // Date/heure où les cotes ont été capturées
  prediction_date: Date;    // Date/heure de la prédiction (≤ match_date)
  result_date: Date;        // Date/heure où le résultat est devenu disponible
  
  // Cotes (au moment de la prédiction)
  odds_home: number;
  odds_draw: number;
  odds_away: number;
  
  // Résultat (post-match — utilisé uniquement pour évaluation)
  home_goals: number;
  away_goals: number;
  result: '1' | 'X' | '2';  // Home / Draw / Away
  
  // Contexte
  season: string;
  is_virtual: boolean;       // Football virtuel vs réel
}
```

### Sources de données

| Source | Utilisation | Anti-leakage garantie |
|--------|-------------|----------------------|
| `predictions` table (DB) | Prédictions historiques déjà faites | ✅ Les cotes et features sont snapshotted au moment de la prédiction |
| `match_results` table (DB) | Résultats réels | ✅ Résultat disponible uniquement après `result_date` |
| `scraped_data` table (DB) | Cotes historiques | ⚠️ Vérifier que `odds_date` ≤ `prediction_date` |

### Anti-Data-Leakage Tests

```typescript
// Pour chaque match dans le dataset de backtest :
function validateNoLeakage(match: BacktestMatch): boolean {
  // 1. Cotes capturées avant le match
  assert(match.odds_date <= match.match_date);
  
  // 2. Prédiction faite avant le match
  assert(match.prediction_date <= match.match_date);
  
  // 3. Features historiques n'utilisent que des matchs antérieurs
  const historicalMatches = dataset.filter(m => 
    m.match_date < match.prediction_date  // STRICTLY before prediction
  );
  
  // 4. Form : 5 derniers matchs doivent être antérieurs à prediction_date
  const formMatches = historicalMatches
    .filter(m => m.home_team === match.home_team || m.away_team === match.away_team)
    .sort((a, b) => b.match_date - a.match_date)
    .slice(0, 5);
  
  for (const fm of formMatches) {
    assert(fm.match_date < match.prediction_date, 
      `Leakage: form match ${fm.match_id} at ${fm.match_date} is after prediction at ${match.prediction_date}`);
  }
  
  return true;
}
```

---

## 3. BASELINES

### Baseline A — Majority Class

Toujours prédire "Home win" (classe majoritaire dans le football).

```typescript
function baselineMajority(): Prediction {
  return { prediction: '1', confidence: 1/3 }; // Toujours Home
}
```

### Baseline B — Implied Odds Probabilities

Utiliser directement les probabilités implicites des cotes (sans margin removal).

```typescript
function baselineImpliedOdds(odds: Odds): Prediction {
  const pH = 1 / odds.home;
  const pD = 1 / odds.draw;
  const pA = 1 / odds.away;
  const total = pH + pD + pA; // Margin
  return {
    probHome: pH / total,
    probDraw: pD / total,
    probAway: pA / total,
    prediction: max(pH, pD, pA) === pH ? '1' : max(pH, pD, pA) === pD ? 'X' : '2',
    confidence: max(pH, pD, pA) / total,
  };
}
```

### Baseline C — Poisson from Odds (no adjustments)

Grid search λH, λA pour reproduire les cotes, puis score matrix Poisson brute. PAS de form, PAS de H2H, PAS de AI, PAS de virtual redistribution.

### Model D — Current Model

Le modèle actuel avec tous les ajustements (form, H2H, stats, AI, trap, virtual redistribution).

### Ablation Models

| Model | Description | Ce qui est retiré |
|-------|-------------|-------------------|
| Model E | Current sans H2H | `H2H_HOME_BOOST = 0`, `H2H_AWAY_PENALTY = 0` |
| Model F | Current sans form | `FORM_WEIGHT_* = 0`, `FORM_ATTACK_BOOST = 0`, `FORM_DEFENSE_PENALTY = 0` |
| Model G | Current sans momentum | `MOMENTUM_SCALE = Infinity` (effectivement 0) |
| Model H | Current sans trap | Tous les anti-trap penalties = 0 |
| Model I | Current sans AI | `AI_WEIGHT = 0` |
| Model J | Optimized statistical | Coefficients optimisés sur TRAIN (sans AI) |
| Model K | Optimized + AI | Coefficients optimisés sur TRAIN + AI_WEIGHT optimisé |

---

## 4. MÉTRIQUES

### Métriques Principales (qualité probabiliste)

| Métrique | Formule | Interprétation |
|----------|---------|----------------|
| **Log Loss** | -1/N Σ [yᵢ log(pᵢ) + (1-yᵢ) log(1-pᵢ)] | Plus bas = meilleure calibration probabiliste. Pénalise les prédictions confidentes et fausses. |
| **Brier Score** | 1/N Σ (pᵢ - yᵢ)² | Plus bas = meilleure. Variante probabiliste du MSE. |
| **ECE** | Σᵦ (nᵦ/N) \|accᵦ - confᵦ\| | Expected Calibration Error. Plus bas = meilleure calibration. |

### Métriques Secondaires (classification)

| Métrique | Formule | Interprétation |
|----------|---------|----------------|
| Accuracy | Σ 1(ŷᵢ = yᵢ) / N | % correct (insuffisant seul) |
| Precision | TP / (TP + FP) | Par classe |
| Recall | TP / (TP + FN) | Par classe |
| F1 | 2 × P × R / (P + R) | Harmonique |

### Métriques par Segment

Pour chaque métrique, calculer aussi :
- **Par ligue** : Différences de performance entre ligues
- **Par confiance** : Performance dans les buckets [25-40], [40-55], [55-70], [70-82]
- **Par résultat 1X2** : Home / Draw / Away séparément
- **Par période temporelle** : Début vs fin du dataset (dérive du modèle)

### Calibration Curve (Reliability Diagram)

```
Confidence bins:  [25-35] [35-45] [45-55] [55-65] [65-75] [75-82]
                     ↓       ↓       ↓       ↓       ↓       ↓
Actual accuracy:   [0.28]  [0.38]  [0.48]  [0.58]  [0.70]  [0.80]
                     ↓       ↓       ↓       ↓       ↓       ↓
Perfect calibration: [0.30]  [0.40]  [0.50]  [0.60]  [0.70]  [0.78]
```

Si la courbe dévie significativement de la diagonale, la confidence n'est PAS calibrée.

---

## 5. CALIBRATION

### Platt Scaling

Fit logistique : `calibrated = 1 / (1 + exp(A × raw + B))`

- A, B optimisés sur TRAIN par maximum likelihood
- Testé sur TEST indépendant
- Monotone — préserve l'ordre des prédictions

### Isotonic Regression

Fit piecewise-constant monotone :

- Plus flexible que Platt
- Peut overfitter sur petits datasets
- Garantit monotonicité

### Beta Calibration

`calibrated = F(a, b) / (F(a, b) + F(c, d))` où F = fonction Beta incomplète

- 3 paramètres (a, b, c)
- Plus flexible que Platt, moins qu'Isotonic
- Peut modéliser les asymétries de calibration

### Procédure

1. Collecter les (confidence, résultat) pairs sur TRAIN
2. Fit Platt / Isotonic / Beta sur TRAIN
3. Appliquer la calibration sur TEST
4. Comparer ECE avant/après calibration
5. Choisir la méthode avec le meilleur ECE sur TEST

**Règle** : TEST ne doit JAMAIS être utilisé pour sélectionner les paramètres de calibration.

---

## 6. COEFFICIENT OPTIMIZATION

### Grid Search (pour petit nombre de coefficients)

```typescript
// Optimiser VIRTUAL_AVG_GOALS et AI_WEIGHT ensemble
const grid = [];
for (const vag of [0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8]) {
  for (const aiw of [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35]) {
    const brierScore = runWalkForward({ VIRTUAL_AVG_GOALS: vag, AI_WEIGHT: aiw });
    grid.push({ VIRTUAL_AVG_GOALS: vag, AI_WEIGHT: aiw, brierScore });
  }
}
// Select minimum brierScore on TRAIN
// Validate on TEST
```

### Bayesian Optimization (pour grand nombre de coefficients)

Utiliser une bibliothèque comme `bayesopt` ou implémenter Gaussian Process optimization pour les 9+ coefficients arbitraires simultanément.

**Règle** : Optimiser sur TRAIN. Le TEST ne sert qu'à la validation finale.

---

## 7. AI WEIGHT EVALUATION

### Protocol

```
Pour AI_WEIGHT dans [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50] :
  1. Configurer AI_WEIGHT = valeur
  2. Run walk-forward sur TRAIN
  3. Calculer Brier, LogLoss, ECE, Accuracy
  4. Stocker résultats

Sélectionner AI_WEIGHT* = argmin Brier sur TRAIN
Valider sur TEST : Brier(AI_WEIGHT*) vs Brier(0)
```

### Critères de décision

| Résultat | Action |
|----------|--------|
| Brier(AI_WEIGHT*) < Brier(0) sur TRAIN ET TEST | Garder AI |
| Brier(AI_WEIGHT*) < Brier(0) sur TRAIN mais > sur TEST | Overfitting — réduire AI_WEIGHT |
| Brier(AI_WEIGHT*) ≈ Brier(0) sur TEST | AI n'apporte rien — mettre AI_WEIGHT = 0 |
| Brier(AI_WEIGHT*) > Brier(0) | AI dégrade le modèle — mettre AI_WEIGHT = 0 |

---

## 8. POISSON MODEL COMPARISON

### Models à comparer

| Model | Description |
|-------|-------------|
| Poisson (current) | Grid search λ, score matrix 7×7 |
| Dixon-Coles | Poisson + correction τ pour low-scoring |
| Bivariate Poisson | Poisson avec corrélation home/away |
| Empirical | Distribution empirique des scores |

### Tests statistiques

| Test | Objectif |
|------|----------|
| Overdispersion | Variance empirique > λ ? Si oui, Negative Binomial meilleur |
| Zero-inflation | P(0-0) empirique > P(0-0) Poisson ? Si oui, Zero-Inflated Poisson |
| Home/Away dependence | Corrélation empirique home/away goals ≠ 0 ? Si oui, Bivariate Poisson |
| Goodness of fit (χ²) | Score distribution empirique vs Poisson théorique |

### Paramètres Dixon-Coles

```typescript
// τ correction for low-scoring draws
// τ(λH, λA) adjusts P(0,0), P(1,0), P(0,1), P(1,1)
function dixonColesTau(lambdaH: number, lambdaA: number, rho: number): number {
  // rho: correlation parameter (typically -0.1 to 0.1)
  // For virtual football, rho may differ from real football
  if (lambdaH <= 1 && lambdaA <= 1) {
    return 1 - lambdaH * lambdaA * rho;
  }
  return 1;
}
```

---

## 9. IMPLEMENTATION

### Structure de fichiers proposée

```
src/lib/prediction/
├── backtest/
│   ├── framework.ts          # Walk-forward engine
│   ├── anti-leakage.ts       # Data leakage guards
│   ├── metrics.ts            # Brier, LogLoss, ECE, etc.
│   ├── calibration.ts        # Platt, Isotonic, Beta
│   └── baselines.ts          # Baseline models
├── odds.ts                   # Step 1
├── poisson.ts                # Step 2 + grid search
├── dixon-coles.ts            # Tau correction (new)
├── features.ts               # Steps 3-5 (form, H2H, stats)
├── score-matrix.ts           # Step 6
├── ai.ts                     # Step 7
├── virtual-model.ts          # Step 8
├── trap-detector.ts          # Steps 9-10
├── markets.ts                # Steps 11-12
├── confidence.ts             # Step 13
├── evaluation.ts             # Quality evaluation
└── prediction-engine.ts      # Orchestrator (thin)
```

### Configuration de versionnage

```typescript
const MODEL_VERSION = {
  model: 'poisson-v4',
  features: 'features-v3',
  calibration: 'uncalibrated', // → 'isotonic-v1' après calibration
  config: 'config-v1',         // Hash des coefficients
};
```

Chaque prédiction stockée doit inclure `MODEL_VERSION` pour permettre la comparaison rétrospective.

---

## 10. ORDRE D'EXÉCUTION

| Étape | Action | Durée estimée |
|-------|--------|---------------|
| 1 | Construire dataset de backtest (historique DB → BacktestMatch[]) | 2h |
| 2 | Implémenter anti-data-leakage tests | 2h |
| 3 | Implémenter walk-forward framework | 4h |
| 4 | Run Baseline A (majority class) | 30min |
| 5 | Run Baseline B (implied odds) | 30min |
| 6 | Run Baseline C (Poisson raw) | 1h |
| 7 | Run Model D (current) | 1h |
| 8 | Run ablation models E-I | 3h |
| 9 | Analyser résultats — identifier features utiles vs nuisibles | 2h |
| 10 | Optimiser coefficients sur TRAIN | 4h |
| 11 | Run Model J (optimized) sur TEST | 1h |
| 12 | Évaluer AI_WEIGHT | 2h |
| 13 | Run Model K (optimized + AI) sur TEST | 1h |
| 14 | Calibration (Platt/Isotonic/Beta) | 3h |
| 15 | Produire MODEL_V2_REPORT.md | 2h |

**Total estimé** : ~28h

---

*Ce framework doit être implémenté et exécuté avant toute déclaration que le modèle est "meilleur" ou que les coefficients sont "validés".*
