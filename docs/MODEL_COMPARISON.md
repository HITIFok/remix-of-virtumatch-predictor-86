# Rapport d'Audit — Comparaison de Modèles

**Projet :** VirtuMatch Predictor
**Date :** 2026-03-05
**Statut :** ❌ COMPARAISON DE MODÈLES NON PROUVÉE
**Auditeur :** Audit automatique approfondi
**Référence standard :** Diebold & Mariano (1995), Dixon & Coles (1997), Ley et al. (2019)

---

## 1. État actuel — Analyse détaillée

### 1.1 Constat principal

**Aucune comparaison de modèles n'existe dans le projet VirtuMatch Predictor.** Cela signifie que :

- Aucune baseline n'a été calculée.
- Aucun test de significativité statistique n'a été effectué.
- Aucun intervalle de confiance sur les métriques n'existe.
- On ne sait pas si le modèle est meilleur que le hasard, meilleur que les cotes des bookmakers, ou meilleur qu'un modèle trivial.

### 1.2 Pourquoi la comparaison est indispensable

Un modèle de prédiction n'a de valeur que **relativement** à des alternatives. Un modèle qui prédit correctement 52% des résultats de football pourrait être :

- **Excellent** : si les cotes des bookmakers prédisent correctement 51% et la baseline majorité 50%.
- **Médiocre** : si les cotes prédisent 53% et un Poisson simple 52%.
- **Inutile** : si les cotes prédisent 55% et que le modèle n'apporte rien au-delà.

Sans comparaison, **on ne peut pas savoir** dans quel cas on se trouve.

---

## 2. Spécification complète des 10 baselines

### 2.1 Baseline 1 : Majorité (Always Home)

**Description :** Toujours prédire la classe majoritaire. En football, l'équipe à domicile gagne le plus souvent (~46% en moyenne historique).

**Calcul :**

```
p_home = fréquence historique de victoire domicile = ~0.46
p_draw = fréquence historique de nul = ~0.26
p_away = fréquence historique de victoire extérieur = ~0.28
```

**Comportement attendu :**
- Accuracy ≈ 46% (toujours prédire domicile).
- Log Loss = -(0.46 × log(0.46) + 0.26 × log(0.26) + 0.28 × log(0.28)) ≈ 1.08.
- Brier Score ≈ 0.67.
- ECE : mal calibré par construction (probabilités constantes vs fréquences variables).

**Intérêt :** C'est le plancher absolu. Tout modèle utile doit battre cette baseline.

### 2.2 Baseline 2 : Cotes implicites brutes

**Description :** Convertir les cotes décimales en probabilités implicites sans normalisation.

**Calcul :**

```
p_home_raw = 1 / odds_home
p_draw_raw = 1 / odds_draw
p_away_raw = 1 / odds_away
```

**Comportement attendu :**
- Somme > 1 (overround des bookmakers, typiquement 1.05-1.15).
- Probabilités biaisées vers le haut.
- ECE ≈ 0.02-0.05 (les bookmakers sont bien calibrés).
- Accuracy ≈ 48-50%.

**Problème :** Les probabilités ne somment pas à 1. Ce n'est pas un modèle probabiliste valide.

### 2.3 Baseline 3 : Cotes implicites normalisées

**Description :** Normaliser les cotes implicites pour obtenir une distribution de probabilité valide.

**Calcul :**

```
overround = (1/odds_home + 1/odds_draw + 1/odds_away)
p_home = (1/odds_home) / overround
p_draw = (1/odds_draw) / overround
p_away = (1/odds_away) / overround
```

**Comportement attendu :**
- Somme = 1.0 par construction.
- ECE ≈ 0.02-0.04 (excellente calibration car les bookmakers sont très bien calibrés).
- Accuracy ≈ 49-51%.
- C'est la **baseline de référence** pour tout modèle de prédiction sportive.

**Pourquoi c'est la barre minimale :** Si un modèle ne bat pas les cotes normalisées, il n'apporte aucune valeur ajoutée par rapport au marché. L'utilisateur pourrait simplement utiliser les cotes des bookmakers et obtenir de meilleures prédictions.

### 2.4 Baseline 4 : Poisson simple

**Description :** Modèle de Poisson avec λ = moyenne de buts par équipe (historique global).

**Calcul :**

```
λ_home = moyenne_buts_marqués_domicile (toutes équipes confondues)
λ_away = moyenne_buts_marqués_extérieur (toutes équipes confondues)

P(buts_home = k) = (λ_home^k × e^(-λ_home)) / k!
P(buts_away = k) = (λ_away^k × e^(-λ_away)) / k!

p_home = Σ P(home=k) × P(away<j)  pour k>j
p_draw = Σ P(home=k) × P(away=k)
p_away = Σ P(home=k) × P(away>j)  pour k<j
```

**Comportement attendu :**
- Accuracy ≈ 47-49%.
- Log Loss ≈ 1.00-1.05.
- Brier Score ≈ 0.65-0.68.
- ECE : modérément calibré.

**Pourquoi Poisson est une baseline forte :** Le modèle de Poisson est le modèle standard pour les buts de football depuis Maher (1982) et Dixon-Coles (1997). Il capture la dynamique fondamentale des scores de football (faible moyenne, distribution asymétrique). Beaucoup de modèles publiés dans la littérature ne battent pas Poisson de manière significative.

### 2.5 Baseline 5 : VirtuMatch complet (modèle actuel)

**Description :** Le modèle VirtuMatch avec tous les composants (IA, H2H, Form, Momentum, Anti-trap, Stats).

**Comportement :** **INCONNU** — aucune métrique out-of-sample n'a été calculée.

### 2.6 Baselines 6-10 : Ablations de VirtuMatch

| # | Modèle | Description |
|---|---|---|
| 6 | VirtuMatch sans IA | `AI_WEIGHT = 0`, poids redistribués |
| 7 | VirtuMatch sans H2H | Composant H2H désactivé |
| 8 | VirtuMatch sans Form | Composant Form (et Momentum) désactivé |
| 9 | VirtuMatch sans Momentum | Composant Momentum désactivé |
| 10 | VirtuMatch sans Anti-trap | Filtre anti-trap désactivé |

**Comportement :** **INCONNU** pour toutes les ablations.

---

## 3. Pourquoi « battre les cotes implicites » est le minimum

### 3.1 L'argument fondamental

Les cotes des bookmakers reflètent les **probabilités conditionnelles du marché**. Elles agrègent :

- Les modèles quantitatifs des bookmakers (Poisson, Dixon-Coles, ELO, etc.).
- L'information des parieurs (wisdom of the crowd).
- Les ajustements de marge (overround).

Un modèle de prédiction qui ne bat pas les cotes implicites normalisées est **redondant** : l'utilisateur peut obtenir de meilleures prédictions gratuitement en regardant les cotes.

### 3.2 Barre de référence

| Niveau | Description | Signification |
|---|---|---|
| < Baseline majorité | Le modèle est pire que prédire toujours la même chose | Inutile |
| ≈ Baseline majorité | Le modèle n'apprend rien | Inutile |
| > Majorité, < Cotes | Le modèle bat le hasard mais pas le marché | Faible |
| ≈ Cotes normalisées | Le modèle égale le marché | Acceptable (pas de valeur ajoutée) |
| > Cotes normalisées | Le modèle bat le marché | **Objectif** |
| >> Cotes normalisées | Le modèle bat le marché significativement | Excellent (rare) |

### 3.3 Réalité de l'industrie

Battre les cotes des bookmakers **de manière consistante** est extrêmement difficile. Les bookmakers ont :

- Des décennies de données historiques.
- Des modèles quantitatifs sophistiqués.
- Des analystes professionnels.
- L'information des marchés de paris (volume, mouvements).

La plupart des modèles académiques publiés ne battent pas les cotes de manière statistiquement significative sur de longues périodes. Un modèle qui bat les cotes de +1-2% en accuracy est déjà remarquable.

---

## 4. Pourquoi Poisson simple est une baseline forte

### 4.1 Fondement théorique

Le modèle de Poisson est fondé sur l'hypothèse que les buts dans un match de football suivent une distribution de Poisson :

```
P(X = k) = (λ^k × e^(-λ)) / k!
```

Cette hypothèse est **raisonnable** pour les buts de football car :

- Les buts sont des événements rares (moyenne ~1.3-2.7 par match).
- Les buts sont approximativement indépendants (chaque occasion de but est un essai de Bernoulli).
- La distribution de Poisson est la limite de Bernoulli pour n → ∞, p → 0, np = λ.

### 4.2 Performance historique

Le modèle de Poisson simple (λ constant par équipe) atteint typiquement :

- Accuracy ≈ 47-49% (meilleur que la baseline majorité).
- Log Loss ≈ 1.00-1.05.
- Brier Score ≈ 0.65-0.68.

Le modèle de Poisson de Dixon-Coles (avec attaque/défense par équipe et facteur temporel) atteint :

- Accuracy ≈ 49-52%.
- Log Loss ≈ 0.95-1.00.
- Brier Score ≈ 0.62-0.65.

### 4.3 Implication pour VirtuMatch

Si VirtuMatch ne bat pas un Poisson simple, alors les ~40 coefficients et les 6 composants ajoutent **plus de bruit que de signal**. C'est un résultat possible et même probable pour un modèle avec des coefficients non optimisés.

---

## 5. Tests statistiques requis

### 5.1 Test de Diebold-Mariano (1995)

**But :** Tester si deux modèles ont des erreurs de prévision significativement différentes.

**Hypothèse nulle H₀ :** E[d_t] = 0, où d_t = L(e₁ₜ) - L(e₂ₜ) est la différence de loss entre les deux modèles au temps t.

**Statistique :**

```
DM = d̄ / sqrt(Vâr(d̄))
```

Où d̄ = (1/T) × Σ d_t et Vâr(d̄) est estimée par la méthode de Newey-West (pour l'autocorrélation).

**Sous H₀ :** DM ~ N(0, 1) asymptotiquement.

**Interprétation :**
- |DM| > 1.96 : différence significative à 5%.
- |DM| > 2.58 : différence significative à 1%.

**Application :** Comparer VirtuMatch vs chaque baseline. Si DM < -1.96, VirtuMatch est significativement meilleur. Si DM > 1.96, la baseline est significativement meilleure.

### 5.2 Intervalles de confiance bootstrap

**But :** Estimer l'incertitude sur chaque métrique.

**Méthode :**

1. Rééchantillonner les prédictions avec remise (B = 10 000 fois).
2. Calculer la métrique sur chaque échantillon bootstrap.
3. Prendre les percentiles 2.5% et 97.5% pour l'IC à 95%.

**Exemple :**

```
Accuracy VirtuMatch = 0.52 [0.50, 0.54] (IC 95%)
Accuracy Cotes      = 0.51 [0.49, 0.53] (IC 95%)
→ Chevauchement des IC : différence non significative
```

### 5.3 Test de McNemar

**But :** Comparer les taux de classification correcte de deux modèles sur les mêmes données.

**Table de contingence :**

```
                    Modèle 2 correct
                    Oui     Non
Modèle 1 correct  ┌──────┬──────┐
  Oui              │  a   │  b   │
  Non              │  c   │  d   │
                   └──────┴──────┘
```

**Statistique :**

```
χ² = (|b - c| - 1)² / (b + c)  ~ χ²(1)
```

**Interprétation :** Si χ² > 3.84, les deux modèles ont des taux de classification significativement différents (à 5%).

### 5.4 Quand utiliser chaque test

| Test | Quand l'utiliser | Métrique comparée |
|---|---|---|
| Diebold-Mariano | Séries temporelles de loss | Log Loss, Brier Score |
| McNemar | Classification binaire/multi | Accuracy |
| Bootstrap IC | Toute métrique | Toutes |

---

## 6. Comparaison actuelle : VirtuMatch vs baselines

### 6.1 État des connaissances

| # | Modèle | Accuracy | Log Loss | Brier | ECE | État |
|---|---|---|---|---|---|---|
| 1 | Majorité | ? | ? | ? | ? | ❌ Non calculé |
| 2 | Cotes brutes | ? | ? | ? | ? | ❌ Non calculé |
| 3 | Cotes normalisées | ? | ? | ? | ? | ❌ Non calculé |
| 4 | Poisson simple | ? | ? | ? | ? | ❌ Non calculé |
| 5 | VirtuMatch complet | ? | ? | ? | ? | ❌ Pas de métriques OOS |
| 6 | VirtuMatch sans IA | ? | ? | ? | ? | ❌ Non calculé |
| 7 | VirtuMatch sans H2H | ? | ? | ? | ? | ❌ Non calculé |
| 8 | VirtuMatch sans Form | ? | ? | ? | ? | ❌ Non calculé |
| 9 | VirtuMatch sans Momentum | ? | ? | ? | ? | ❌ Non calculé |
| 10 | VirtuMatch sans Anti-trap | ? | ? | ? | ? | ❌ Non calculé |

**Toutes les valeurs sont INCONNUES.**

### 6.2 Questions fondamentales sans réponse

| Question | Réponse | Conséquence si réponse est négative |
|---|---|---|
| VirtuMatch bat-il les cotes implicites ? | INCONNU | Le modèle est inutile (le marché est meilleur) |
| VirtuMatch bat-il un Poisson simple ? | INCONNU | Les 40 coefficients ajoutent du bruit |
| VirtuMatch bat-il la baseline majorité ? | INCONNU | Le modèle est pire que prédire toujours domicile |
| L'IA améliore-t-elle la prédiction ? | INCONNU | Le coût de l'IA est gaspillé |
| Le H2H améliore-t-il la prédiction ? | INCONNU | Le H2H ajoute du bruit |
| L'Anti-trap filtre-t-il correctement ? | INCONNU | Le filtre supprime de bonnes prédictions |

---

## 7. Comment calculer les métriques — Procédure pas à pas

### 7.1 Étape 1 : Extraction des données

```sql
-- Extraire les prédictions vérifiées avec résultats connus
SELECT 
    p.match_id,
    p.prediction_date,
    p.prob_home,
    p.prob_draw,
    p.prob_away,
    m.home_goals,
    m.away_goals,
    m.result,
    o.odds_home,
    o.odds_draw,
    o.odds_away
FROM predictions p
JOIN matches m ON p.match_id = m.id
JOIN odds o ON p.match_id = o.match_id
WHERE m.status = 'completed'
  AND p.prediction_date < m.match_date
ORDER BY p.prediction_date;
```

### 7.2 Étape 2 : Calcul des baselines

Pour chaque match dans l'ensemble de test :

1. **Majorité** : p_home = 0.46, p_draw = 0.26, p_away = 0.28 (constantes).
2. **Cotes brutes** : p = 1/odds (non normalisées).
3. **Cotes normalisées** : p = (1/odds) / overround.
4. **Poisson simple** : calculer P(home=k) × P(away=j) pour k,j ≤ 7, sommer.

### 7.3 Étape 3 : Calcul des métriques

Pour chaque modèle (baseline + VirtuMatch + ablations) :

```typescript
// Accuracy
accuracy = correct_predictions / total_predictions;

// Log Loss
logLoss = -mean(sum(y_true * log(p_pred), axis=classes));

// Brier Score
brier = mean(sum((p_pred - y_onehot)^2, axis=classes));

// ECE (10 bins)
for each bin b in [0, 0.1), [0.1, 0.2), ..., [0.9, 1.0]:
    count_b = number of predictions in bin b;
    accuracy_b = observed frequency of success in bin b;
    confidence_b = mean predicted probability in bin b;
    ece += (count_b / N) * |accuracy_b - confidence_b|;
```

### 7.4 Étape 4 : Tests de significativité

- Pour chaque paire (VirtuMatch, baseline_i) :
  - Calculer DM statistic.
  - Calculer McNemar χ².
  - Calculer bootstrap IC à 95%.

### 7.5 Étape 5 : Présentation des résultats

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Tableau Comparatif des Modèles                            │
│                    (métriques out-of-sample, saison TEST)                    │
├──────────────────┬──────────┬──────────┬──────────┬──────────┬──────────────┤
│ Modèle           │ Accuracy │ Log Loss │  Brier   │   ECE    │  vs Cotes    │
├──────────────────┼──────────┼──────────┼──────────┼──────────┼──────────────┤
│ Majorité         │  0.460   │  1.080   │  0.667   │  0.120   │     -        │
│ Cotes norm.      │  0.505   │  0.990   │  0.630   │  0.030   │   réf.       │
│ Poisson simple   │  0.485   │  1.020   │  0.660   │  0.080   │   -3.0%      │
│ VirtuMatch       │  0.520   │  0.980   │  0.620   │  0.100   │   +3.0%      │
│ Vm sans IA       │  0.515   │  0.985   │  0.625   │  0.095   │   +2.0%      │
│ Vm sans H2H      │  0.525   │  0.975   │  0.615   │  0.090   │   +4.0%*     │
│ Vm sans Form     │  0.500   │  1.010   │  0.640   │  0.110   │   -1.0%      │
│ Vm sans Momentum │  0.520   │  0.980   │  0.620   │  0.100   │   +3.0%      │
│ Vm sans Anti-trap│  0.518   │  0.982   │  0.622   │  0.100   │   +2.6%      │
├──────────────────┴──────────┴──────────┴──────────┴──────────┴──────────────┤
│ * significatif à 5% (test DM)                                              │
│ Valeurs ILLUSTRATIVES — à remplacer par les vraies métriques OOS           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Déficits identifiés — Synthèse

| Déficit | Gravité | Détail | Impact |
|---|---|---|---|
| Aucune baseline calculée | CRITIQUE | Impossible de savoir si le modèle est meilleur que le hasard | Valeur ajoutée inconnue |
| Pas de métriques out-of-sample | CRITIQUE | Métriques potentiellement biaisées (data snooping) | Performance réelle inconnue |
| Pas de test de significativité | ÉLEVÉ | Impossible de distinguer signal de bruit | Amélioration aléatoire vs réelle |
| Pas d'intervalles de confiance | ÉLEVÉ | Incertitude sur la stabilité des métriques | Résultats non reproductibles |
| Pas de comparaison avec cotes | CRITIQUE | Les bookmakers sont la baseline naturelle | On ne sait pas si on bat le marché |
| Pas de comparaison avec Poisson | ÉLEVÉ | Poisson est le standard académique | Positionnement scientifique inconnu |
| Pas de test Diebold-Mariano | ÉLEVÉ | Standard pour comparer des modèles de prévision | Significativité non établie |

---

## 9. Recommandation détaillée

### 9.1 Construction des baselines

1. **Implémenter** les 4 baselines non-VirtuMatch (majorité, cotes brutes, cotes normalisées, Poisson simple).
2. **Implémenter** les 5 ablations VirtuMatch (sans IA, sans H2H, sans Form, sans Momentum, sans Anti-trap).
3. **Calculer** toutes les métriques sur les mêmes données de test (comparaison équitable).

### 9.2 Calcul des métriques

4. **Calculer** Accuracy, Log Loss, Brier Score, ECE pour chaque modèle.
5. **Calculer** par classe (Domicile, Nul, Extérieur) : Precision, Recall, F1.
6. **Calculer** ROI simulé (si on pariait selon chaque modèle).

### 9.3 Tests de significativité

7. **Effectuer** le test de Diebold-Mariano pour chaque paire (VirtuMatch, baseline_i).
8. **Effectuer** le test de McNemar pour l'accuracy.
9. **Calculer** les intervalles de confiance bootstrap (10 000 itérations, IC 95%).

### 9.4 Rapport

10. **Présenter** le tableau comparatif avec toutes les métriques.
11. **Indiquer** la significativité statistique (étoiles pour p < 0.05, p < 0.01).
12. **Conclure** : VirtuMatch bat-il les cotes de manière statistiquement significative ?

---

## 10. Conclusion

Sans comparaison avec des baselines, il est **impossible de déterminer si le VirtuMatch Predictor apporte une valeur ajoutée** par rapport à des méthodes simples ou aux cotes des bookmakers. Les 10 baselines n'ont jamais été calculées, aucun test de significativité n'a été effectué, et les 6 questions fondamentales (bat-il les cotes ? Poisson ? Majorité ? etc.) restent sans réponse.

**L'état actuel est COMPARAISON DE MODÈLES NON PROUVÉE.** La comparaison avec les cotes normalisées est la barre minimale : si VirtuMatch ne bat pas les cotes, il n'apporte aucune valeur par rapport au marché.

---

*Ce rapport doit être mis à jour après l'implémentation des baselines (FIX-V3-09) et des tests de significativité.*
