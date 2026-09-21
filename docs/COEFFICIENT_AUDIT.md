# Rapport d'Audit — Coefficients du Modèle

**Projet :** VirtuMatch Predictor
**Date :** 2026-03-05
**Statut :** ❌ COEFFICIENTS NON PROUVÉS
**Auditeur :** Audit automatique approfondi
**Fichier source principal :** `prediction-config.ts`

---

## 1. Inventaire complet des coefficients

### 1.1 Répartition par type

| Type | Définition | Quantité | Pourcentage |
|---|---|---|---|
| **EMPIRIQUE** | Dérivé de données réelles par optimisation statistique | **0** | **0 %** |
| **HEURISTIQUE** | Basé sur le raisonnement ou l'expérience, pas sur l'optimisation | ~25 | ~63 % |
| **ARBITRAIRE** | Valeur choisie sans justification théorique ou empirique | ~15 | ~37 % |
| **Total** | — | **~40** | **100 %** |

**Constat critique :** Il y a **0 coefficient empirique** dans tout le modèle. Tous les ~40 coefficients sont soit heuristiques soit arbitraires.

---

## 2. Table complet des 40 coefficients

### 2.1 Coefficients de poids globaux

| # | Nom | Valeur | Min | Max | Type | Source / Justification |
|---|---|---|---|---|---|---|
| 1 | `AI_WEIGHT` | 0.35 | 0 | 1 | ARBITRAIRE | Aucune. Poids du signal LLM, non optimisé. |
| 2 | `STAT_BASE` | 0.30 | 0 | 1 | HEURISTIQUE | Raisonné mais non optimisé. Poids de base statistique. |
| 3 | `STAT_ATTACK` | 0.40 | 0 | 1 | HEURISTIQUE | L'attaque jugée plus importante que la défense. Non prouvé. |
| 4 | `STAT_DEF` | 0.30 | 0 | 1 | HEURISTIQUE | Complément de STAT_BASE + STAT_ATTACK. |

### 2.2 Coefficients de forme (Form)

| # | Nom | Valeur | Min | Max | Type | Source / Justification |
|---|---|---|---|---|---|---|
| 5 | `FORM_ATTACK_BOOST` | 0.15 | 0 | 1 | ARBITRAIRE | Aucune. Bonus pour attaque en forme. |
| 6 | `FORM_DEFENSE_PENALTY` | 0.10 | 0 | 1 | ARBITRAIRE | Aucune. Pénalité pour défense en forme. |
| 7 | `FORM_AGREEMENT_THRESHOLD` | 15 | 0 | 100 | ARBITRAIRE | Aucune. Seuil de concordance forme/cotes. |
| 8 | `FORM_WEIGHT[0]` | 1.5 | 0 | 3 | HEURISTIQUE | Match le plus récent, poids le plus élevé. Ratio 1.5/1.0 arbitraire. |
| 9 | `FORM_WEIGHT[1]` | 1.3 | 0 | 3 | HEURISTIQUE | 2e match récent. Décroissance non optimisée. |
| 10 | `FORM_WEIGHT[2]` | 1.2 | 0 | 3 | HEURISTIQUE | 3e match récent. |
| 11 | `FORM_WEIGHT[3]` | 1.1 | 0 | 3 | HEURISTIQUE | 4e match récent. |
| 12 | `FORM_WEIGHT[4]` | 1.0 | 0 | 3 | HEURISTIQUE | 5e match récent (plus ancien). |

### 2.3 Coefficients H2H (Face-à-Face)

| # | Nom | Valeur | Min | Max | Type | Source / Justification |
|---|---|---|---|---|---|---|
| 13 | `H2H_HOME_BOOST` | 0.5 | 0 | 2 | ARBITRAIRE | Aucune. Bonus H2H à domicile. |
| 14 | `H2H_AWAY_PENALTY` | 0.3 | 0 | 2 | ARBITRAIRE | Aucune. Pénalité H2H à l'extérieur. |
| 15 | `H2H_BIAS_DIVISOR` | 200 | 1 | 1000 | ARBITRAIRE | Aucune. Diviseur pour normaliser le biais H2H. |
| 16 | `H2H_AGREEMENT_THRESHOLD` | 20 | 0 | 100 | ARBITRAIRE | Aucune. Seuil de concordance H2H/cotes. |

### 2.4 Coefficients de statistiques

| # | Nom | Valeur | Min | Max | Type | Source / Justification |
|---|---|---|---|---|---|---|
| 17 | `VIRTUAL_AVG_GOALS` | 1.3 | 0.5 | 3.0 | ARBITRAIRE | Aucune. Moyenne de buts virtuelle pour initialisation. |
| 18 | `DEFAULT_AVG_SCORED` | 1.3 | 0.5 | 3.0 | ARBITRAIRE | Aucune. Valeur par défaut buts marqués. |
| 19 | `DEFAULT_AVG_CONCEDED` | 1.1 | 0.5 | 3.0 | ARBITRAIRE | Aucune. Valeur par défaut buts encaissés. |
| 20 | `DEF_PENALTY_SELF` | 0.5 | 0 | 2 | ARBITRAIRE | Aucune. Pénalité défense propre. |
| 21 | `DEF_PENALTY_CROSS` | 0.3 | 0 | 2 | ARBITRAIRE | Aucune. Pénalité défense croisée. |

### 2.5 Coefficients de confiance

| # | Nom | Valeur | Min | Max | Type | Source / Justification |
|---|---|---|---|---|---|---|
| 22 | `CONF_MAX_BASE` | 68 | 0 | 100 | ARBITRAIRE | Aucune. Plafond de confiance de base. |
| 23 | `CONF_CAP` | 82 | 0 | 100 | ARBITRAIRE | Aucune. Plafond absolu de confiance. |
| 24 | `CONF_MIN` | 25 | 0 | 100 | ARBITRAIRE | Aucune. Plancher de confiance. |
| 25 | `HALF_TIME_FACTOR` | 0.46 | 0 | 1 | ARBITRAIRE | Aucune. Facteur mi-temps. |

### 2.6 Coefficients Poisson

| # | Nom | Valeur | Min | Max | Type | Source / Justification |
|---|---|---|---|---|---|---|
| 26 | `GRID_MIN` | 0.5 | 0.1 | 2.0 | HEURISTIQUE | Borne inférieure lambda. Raisonné mais non optimisé. |
| 27 | `GRID_MAX` | 3.0 | 1.0 | 6.0 | HEURISTIQUE | Borne supérieure lambda. Raisonné mais non optimisé. |
| 28 | `GRID_STEP` | 0.1 | 0.01 | 0.5 | HEURISTIQUE | Pas de la grille. Raisonné. |
| 29 | `POISSON_MAX_GOALS` | 7 | 3 | 15 | HEURISTIQUE | Troncature Poisson. Raisonné. |

### 2.7 Coefficients de saison / contexte

| # | Nom | Valeur | Min | Max | Type | Source / Justification |
|---|---|---|---|---|---|---|
| 30 | `NEW_SEASON_BOOST` | 0.22 | 0 | 1 | ARBITRAIRE | Aucune. Boost début de saison. |
| 31 | `NEW_SEASON_MATCHES` | 5 | 1 | 20 | ARBITRAIRE | Aucune. Nombre de matchs considérés « début de saison ». |

### 2.8 Coefficients anti-trap

| # | Nom | Valeur | Min | Max | Type | Source / Justification |
|---|---|---|---|---|---|---|
| 32 | `TRAP_ODD_DIFF_THRESHOLD` | 0.15 | 0 | 1 | ARBITRAIRE | Aucune. Seuil d'écart cotes/prédiction. |
| 33 | `TRAP_VOLUME_THRESHOLD` | 0.7 | 0 | 1 | ARBITRAIRE | Aucune. Seuil de volume asymétrique. |
| 34 | `TRAP_MOVEMENT_THRESHOLD` | 0.1 | 0 | 1 | ARBITRAIRE | Aucune. Seuil de mouvement de cotes. |
| 35 | `TRAP_CONVERGENCE_THRESHOLD` | 0.6 | 0 | 1 | ARBITRAIRE | Aucune. Seuil de convergence signaux. |
| 36 | `TRAP_LEAGUE_RISK_WEIGHT` | 0.3 | 0 | 1 | ARBITRAIRE | Aucune. Poids du risque ligue. |

### 2.9 Coefficients divers

| # | Nom | Valeur | Min | Max | Type | Source / Justification |
|---|---|---|---|---|---|---|
| 37 | `MOMENTUM_WEIGHT` | 0.20 | 0 | 1 | ARBITRAIRE | Aucune. Poids du momentum. |
| 38 | `MOMENTUM_DECAY` | 0.85 | 0 | 1 | HEURISTIQUE | Décroissance exponentielle. Raisonné mais non optimisé. |
| 39 | `HOME_ADVANTAGE_DEFAULT` | 0.25 | 0 | 1 | HEURISTIQUE | Avantage domicile par défaut. Proche des valeurs publiées (~0.3). |
| 40 | `LEAGUE_ADJUSTMENT_FACTOR` | 1.0 | 0.5 | 2.0 | ARBITRAIRE | Aucune. Facteur d'ajustement par ligue. |

---

## 3. Analyse des coefficients arbitraires

### 3.1 Pourquoi un coefficient est « arbitraire »

Un coefficient est qualifié d'**arbitraire** lorsque :

1. Sa valeur n'a pas été dérivée de données par optimisation statistique (MLE, grid search, bayésien).
2. Sa valeur n'a pas de justification théorique publiée dans la littérature.
3. Changer sa valeur n'a pas d'effet mesurable connu (car aucun backtest n'existe).
4. Il n'existe pas de sensibilité connue (quel impact de changer 0.35 → 0.40 ?).

### 3.2 Détail des 15 coefficients arbitraires

| Coefficient | Valeur | Pourquoi arbitraire | Donnée qui validerait | Impact estimé |
|---|---|---|---|---|
| `AI_WEIGHT` | 0.35 | Poids du LLM non optimisé | Grid search sur VALIDATION | ÉLEVÉ — c'est le poids le plus fort |
| `FORM_ATTACK_BOOST` | 0.15 | Bonus arbitraire | Corrélation forme→buts sur historique | MOYEN |
| `FORM_DEFENSE_PENALTY` | 0.10 | Pénalité arbitraire | Corrélation forme→buts encaissés | MOYEN |
| `FORM_AGREEMENT_THRESHOLD` | 15 | Seuil sans justification | Distribution des écarts forme/cotes | FAIBLE |
| `H2H_HOME_BOOST` | 0.5 | Boost sans base | Avantage domicile observé par ligue | ÉLEVÉ |
| `H2H_AWAY_PENALTY` | 0.3 | Pénalité sans base | Désavantage extérieur observé | ÉLEVÉ |
| `H2H_BIAS_DIVISOR` | 200 | Diviseur sans justification | Calibration de l'effet H2H | MOYEN |
| `H2H_AGREEMENT_THRESHOLD` | 20 | Seuil sans justification | Distribution des écarts H2H/cotes | FAIBLE |
| `VIRTUAL_AVG_GOALS` | 1.3 | Moyenne non calibrée | Moyenne buts par ligue/saison | ÉLEVÉ — impact sur Poisson |
| `DEFAULT_AVG_SCORED` | 1.3 | Valeur par défaut | Moyenne historique par ligue | ÉLEVÉ |
| `DEFAULT_AVG_CONCEDED` | 1.1 | Valeur par défaut | Moyenne historique par ligue | ÉLEVÉ |
| `DEF_PENALTY_SELF` | 0.5 | Pénalité arbitraire | Régression sur données historiques | MOYEN |
| `DEF_PENALTY_CROSS` | 0.3 | Pénalité arbitraire | Régression sur données historiques | MOYEN |
| `HALF_TIME_FACTOR` | 0.46 | Facteur mi-temps | Distribution buts 1ère/2ème mi-temps | MOYEN |
| `NEW_SEASON_BOOST` | 0.22 | Boost sans justification | Performance équipes début saison vs reste | FAIBLE |
| `CONF_MAX_BASE` | 68 | Plafond arbitraire | Analyse de la distribution de confiance | MOYEN |
| `CONF_CAP` | 82 | Plafond arbitraire | Calibration : ECE avant/après cap | ÉLEVÉ — limite la plage de confiance |
| `CONF_MIN` | 25 | Plancher arbitraire | Calibration : ECE avant/après min | MOYEN |

---

## 4. Contraintes structurelles — Preuves formelles

### 4.1 Loi de conservation (poids statistiques)

**Théorème :** STAT_BASE + STAT_ATTACK + STAT_DEF = 1.0

**Preuve :**

```
STAT_BASE     = 0.30
STAT_ATTACK   = 0.40
STAT_DEF      = 0.30
─────────────────────
Somme         = 0.30 + 0.40 + 0.30 = 1.00  ✅ VÉRIFIÉ
```

**Interprétation :** Cette contrainte garantit que les poids statistiques forment une distribution de probabilité (convex combination). L'attaque reçoit 40% du poids, la défense 30%, et la base 30%. Cette répartition est heuristique : on suppose que l'attaque est plus prédictive que la défense, ce qui n'est pas universellement vrai (les modèles académiques comme Dixon-Coles traitent attaque et défense symétriquement).

**Risque :** Si cette contrainte est violée (somme ≠ 1.0), les prédictions pourraient être biaisées. Le framework devrait vérifier cette contrainte automatiquement à l'exécution.

### 4.2 Monotonie des poids de forme

**Théorème :** FORM_WEIGHT est décroissant (les matchs récents ont plus de poids).

**Preuve :**

```
FORM_WEIGHT[0] = 1.5
FORM_WEIGHT[1] = 1.3
FORM_WEIGHT[2] = 1.2
FORM_WEIGHT[3] = 1.1
FORM_WEIGHT[4] = 1.0

1.5 > 1.3 > 1.2 > 1.1 > 1.0  ✅ MONOTONE DÉCROISSANT
```

**Interprétation :** Le match le plus récent a 50% plus de poids que le plus ancien (1.5/1.0 = 1.5). Ce ratio est arbitraire : Dixon-Coles utilise ρ^t avec ρ optimisé par MLE, typiquement ρ ≈ 0.94-0.97 par match, ce qui correspond à un ratio de ~1.06-1.17 entre matchs consécutifs — bien plus faible que le ratio 1.5/1.3 ≈ 1.15 de VirtuMatch.

**Risque :** Le biais de récence est potentiellement trop fort (ratio trop élevé), amplifiant les fluctuations aléatoires.

### 4.3 Bornes Lambda (Poisson)

**Théorème :** GRID_MIN < GRID_MAX et GRID_STEP > 0

**Preuve :**

```
GRID_MIN  = 0.5
GRID_MAX  = 3.0
GRID_STEP = 0.1

0.5 < 3.0  ✅
0.1 > 0    ✅
```

**Interprétation :** La grille lambda couvre [0.5, 3.0] buts/match. La moyenne de buts dans les 5 ligues majeures est typiquement 1.0-2.7, donc cette plage est raisonnable mais mérite vérification par ligue.

**Risque :** Si une ligue a une moyenne > 3.0 (attaques très fortes), la grille tronque les probabilités.

### 4.4 Bornes de confiance

**Théorème :** CONF_MIN < CONF_MAX_BASE < CONF_CAP

**Preuve :**

```
CONF_MIN      = 25
CONF_MAX_BASE = 68
CONF_CAP      = 82

25 < 68 < 82  ✅
```

**Interprétation :** La confiance est artificiellement bornée entre 25% et 82%. Cela empêche le modèle d'exprimer une certitude forte (>82%) ou une forte incertitude (<25%).

**Risque critique :** Ces caps détruisent la calibration. Un modèle bien calibré devrait pouvoir produire des probabilités proches de 0 ou 1 pour des matchs très déséquilibrés. Les caps forcent toutes les prédictions dans une plage étroite, ce qui rend la calibration impossible pour les probabilités extrêmes.

---

## 5. L'insight critique : Métadonnées ≠ Validation statistique

### 5.1 Le piège des métadonnées

Le fichier `prediction-config.ts` contient des propriétés de métadonnées pour chaque coefficient :

```typescript
{
  value: 0.35,
  min: 0,
  max: 1,
  type: 'weight',
  calibrationStatus: 'pending',
  description: 'Poids du signal IA'
}
```

Ces métadonnées donnent l'**illusion** de validation :

- `min` et `max` sont des **gardes-fous syntaxiques** : ils empêchent les valeurs hors plage mais ne disent rien sur la valeur optimale.
- `calibrationStatus: 'pending'` signifie que la calibration **n'a pas été faite**, pas qu'elle est en cours.
- `description` est de la documentation, pas de la validation.

### 5.2 Ce que les métadonnées ne prouvent PAS

| Métadonnée | Ce qu'elle prouve | Ce qu'elle NE prouve PAS |
|---|---|---|
| `min: 0, max: 1` | La valeur est dans [0, 1] | Que la valeur est optimale dans [0, 1] |
| `calibrationStatus: 'pending'` | La calibration n'a pas été faite | Que la calibration donnera un bon résultat |
| `type: 'weight'` | Le coefficient est un poids | Que le poids est correct |
| `description` | Le but du coefficient | Que le coefficient atteint ce but |

### 5.3 Seul un backtest out-of-sample valide

La seule validation statistique légitime est :

1. Optimiser le coefficient sur TRAIN/VALIDATION.
2. Évaluer la performance sur TEST (données non vues).
3. Vérifier que la performance est supérieure aux baselines.
4. Répéter sur plusieurs fenêtres walk-forward.

**Aucun coefficient de VirtuMatch n'a passé ce test.**

---

## 6. Risque de surapprentissage — Analyse des degrés de liberté

### 6.1 Comptage des paramètres

- **Paramètres libres** : ~40 coefficients dans `prediction-config.ts`.
- **Contraintes** : 1 contrainte de conservation (STAT weights = 1.0), 1 contrainte de monotonie (FORM_WEIGHT décroissant).
- **Degrés de liberté effectifs** : ~40 - 2 = ~38.

### 6.2 Données d'entraînement disponibles

- Estimation : ~5 700 matchs dans la base (3 saisons × 5 ligues × 380 matchs).
- Mais les coefficients n'ont pas été optimisés sur ces données — ils sont fixés arbitrairement.
- Si on optimise sur ces données : 5 700 observations / 38 paramètres ≈ 150 observations par paramètre.

### 6.3 Règle empirique

En statistique, la règle empirique pour la régression est de **10-20 observations par paramètre**. Avec 150 observations par paramètre, on est dans la zone acceptable **si les données sont utilisées correctement** (split train/validation/test).

**Cependant :**

- Si on optimise tous les 40 paramètres simultanément sans régularisation, le risque de surapprentissage est élevé.
- Si on utilise un grid search à 5 niveaux par paramètre : 5^40 ≈ 10^28 combinaisons — **impossible**.
- Il faut soit : (a) réduire le nombre de paramètres, (b) utiliser une recherche aléatoire (random search), ou (c) utiliser une optimisation bayésienne.

### 6.4 Recommandation

1. **Réduire** le nombre de paramètres à optimiser simultanément à ~10 (les plus impactants).
2. **Fixer** les 30 autres à des valeurs raisonnables (non optimisées).
3. **Utiliser** le random search ou l'optimisation bayésienne sur les 10 paramètres.
4. **Valider** sur VALIDATION (jamais TEST).
5. **Évaluer** sur TEST pour confirmer la généralisation.

---

## 7. Niveaux de priorité pour la validation des coefficients

### 7.1 Tier 1 — Impact ÉLEVÉ (optimiser en priorité)

| Coefficient | Raison | Donnée requise | Méthode |
|---|---|---|---|
| `AI_WEIGHT` | Plus fort poids du modèle | Backtest OOS avec/sans IA | Ablation + grid search |
| `VIRTUAL_AVG_GOALS` | Impact direct sur Poisson | Moyenne buts par ligue/saison | Empirique direct |
| `DEFAULT_AVG_SCORED` | Valeur par défaut pour nouvelles équipes | Moyenne historique | Empirique direct |
| `DEFAULT_AVG_CONCEDED` | Valeur par défaut pour nouvelles équipes | Moyenne historique | Empirique direct |
| `H2H_HOME_BOOST` | Boost H2H à domicile | Avantage domicile par ligue | Régression |
| `H2H_AWAY_PENALTY` | Pénalité H2H à l'extérieur | Désavantage extérieur par ligue | Régression |
| `CONF_CAP` | Limite la calibration | ECE avant/après cap | Calibration study |

### 7.2 Tier 2 — Impact MOYEN (optimiser ensuite)

| Coefficient | Raison | Méthode |
|---|---|---|
| `FORM_ATTACK_BOOST` | Bonus forme attaque | Grid search sur VALIDATION |
| `FORM_DEFENSE_PENALTY` | Pénalité forme défense | Grid search sur VALIDATION |
| `DEF_PENALTY_SELF` | Pénalité défense propre | Régression |
| `DEF_PENALTY_CROSS` | Pénalité défense croisée | Régression |
| `HALF_TIME_FACTOR` | Facteur mi-temps | Distribution buts 1ère/2ème mi-temps |
| `H2H_BIAS_DIVISOR` | Normalisation H2H | Calibration de l'effet H2H |
| `CONF_MAX_BASE` | Plafond de confiance | Calibration study |
| `CONF_MIN` | Plancher de confiance | Calibration study |
| `MOMENTUM_WEIGHT` | Poids du momentum | Ablation (devrait être 0 si redondant) |
| `HOME_ADVANTAGE_DEFAULT` | Avantage domicile | Valeurs publiées (~0.3 buts) |

### 7.3 Tier 3 — Impact FAIBLE (fixer et documenter)

| Coefficient | Raison | Action |
|---|---|---|
| `FORM_AGREEMENT_THRESHOLD` | Seuil de concordance | Fixer à valeur raisonnée, documenter |
| `H2H_AGREEMENT_THRESHOLD` | Seuil de concordance | Fixer à valeur raisonnée, documenter |
| `NEW_SEASON_BOOST` | Boost début de saison | Fixer, potentiellement supprimer |
| `TRAP_*` (5 coefficients) | Seuils anti-trap | Fixer, valider par métriques anti-trap |
| `LEAGUE_ADJUSTMENT_FACTOR` | Ajustement par ligue | Fixer à 1.0 (neutre) jusqu'à validation |
| `MOMENTUM_DECAY` | Décroissance momentum | Fixer à valeur publiée ou supprimer |

---

## 8. Déficits identifiés — Synthèse

| Déficit | Gravité | Détail | Impact |
|---|---|---|---|
| 0 coefficient empirique | CRITIQUE | Aucun dérivé de données | Modèle non validé |
| 15 coefficients arbitraires | CRITIQUE | Valeurs sans justification | Performance inconnue |
| Métadonnées ≠ validation | ÉLEVÉ | `calibrationStatus` ne prouve rien | Illusion de validation |
| Pas de grid search | ÉLEVÉ | Aucune optimisation systématique | Sous-optimalité garantie |
| Double comptage Momentum ↔ Form | ÉLEVÉ | Signal compté deux fois | Forme sur-représentée |
| 40 paramètres / ~5 700 données | MOYEN | Ratio acceptable mais risque de surapprentissage si optimisation simultanée | Surapprentissage |
| Caps de confiance (25-82%) | ÉLEVÉ | Détruisent la calibration aux extrêmes | Calibration impossible |
| Coefficients client/serveur | MOYEN | Risque de divergence non détectée | Incohérence |

---

## 9. Recommandation détaillée

1. **Tier 1** : Valider empiriquement les 7 coefficients à impact élevé (VIRTUAL_AVG_GOALS, DEFAULT_AVG_SCORED/CONCEDED directement à partir des données ; AI_WEIGHT, H2H_* par ablation + grid search).
2. **Tier 2** : Optimiser les 10 coefficients à impact moyen par grid search/random search sur VALIDATION.
3. **Tier 3** : Fixer les coefficients à faible impact à des valeurs raisonnées et documenter.
4. **Supprimer** Momentum (redondant avec Form par construction).
5. **Retirer** les caps de confiance ou les élargir pour permettre la calibration.
6. **Implémenter** des gardes NaN/Infinity sur tous les calculs.
7. **Unifier** les coefficients client/serveur via un registre centralisé.
8. **Ajouter** des tests automatisés qui vérifient les contraintes structurelles (conservation, monotonie, bornes) à chaque modification.

---

## 10. Conclusion

Sur ~40 coefficients, **0 sont empiriques** et ~15 sont arbitraires. Les contraintes structurelles (conservation, monotonie, bornes) sont respectées, mais cela ne constitue pas une validation statistique. Le fait que des métadonnées (`min`, `max`, `calibrationStatus`) existent dans la configuration crée une **illusion de validation** qui est potentiellement plus dangereuse que l'absence de métadonnées, car elle donne un faux sentiment de rigueur.

**L'état actuel est COEFFICIENTS NON PROUVÉS.** La priorité est de valider les coefficients Tier 1 par des méthodes empiriques (backtest out-of-sample, ablation, calibration).

---

*Ce rapport doit être mis à jour après la validation des coefficients Tier 1 (FIX-V3-07, FIX-V3-13).*
