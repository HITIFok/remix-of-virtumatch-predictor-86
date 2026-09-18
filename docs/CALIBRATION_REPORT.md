# Rapport d'Audit — Calibration des Probabilités

**Projet :** VirtuMatch Predictor
**Date :** 2026-03-05
**Statut :** ❌ CALIBRATION NON PROUVÉE
**Auditeur :** Audit automatique approfondi
**Référence standard :** Guo et al. (2017), Naeini et al. (2015), Platt (1999), Zadrozny & Elkan (2001)

---

## 1. État actuel — Analyse détaillée

### 1.1 Constat principal

**Aucune calibration des probabilités n'a été effectuée dans le projet VirtuMatch Predictor.** Les valeurs de confiance affichées à l'utilisateur (plage 25 %–82 %) sont des **heuristiques non calibrées**, c'est-à-dire des nombres calculés par une formule arbitraire qui n'ont jamais été comparés aux fréquences observées de succès.

### 1.2 Distinction critique : Confiance heuristique vs Probabilité calibrée

Cette distinction est le point le plus important de ce rapport. Elle mérite d'être expliquée en détail car elle est fréquemment mal comprise.

**Confiance heuristique** (état actuel de VirtuMatch) :

- Valeur calculée par une formule ad hoc combinant des signaux (forme, H2H, statistiques, etc.).
- La formule produit un nombre entre 0 et 100, mais ce nombre **n'a pas d'interprétation probabiliste**.
- Si le modèle dit « confiance = 70 % », cela NE SIGNIFIE PAS que le modèle a raison 7 fois sur 10.
- C'est un **score ordinal** : plus élevé = probablement meilleur, mais l'échelle est arbitraire.

**Probabilité calibrée** (ce qu'il faudrait) :

- Valeur p telle que, parmi toutes les prédictions où le modèle dit p = 70 %, exactement 70 % sont correctes.
- Calibration = **correspondance entre probabilité prédite et fréquence observée**.
- Si le modèle dit « probabilité calibrée = 70 % », alors sur 100 telles prédictions, environ 70 seront correctes.
- C'est une **probabilité fréquentiste** avec une interprétation empiriquement vérifiable.

### 1.3 Exemple concret

Supposons que le modèle VirtuMatch produit 100 prédictions avec « confiance = 70 % » :

- **Si le modèle est calibré** : exactement ~70 de ces 100 prédictions seront correctes.
- **Si le modèle est sur-confiant** (typique) : seulement ~50 seront correctes. Le modèle est trop optimiste.
- **Si le modèle est sous-confiant** : ~85 seront correctes. Le modèle est trop pessimiste.

Sans calcul de calibration, **on ne sait pas dans quel cas on se trouve**. L'expérience montre que la plupart des modèles de prédiction non calibrés sont **sur-confiants** : ils attribuent des probabilités trop extrêmes (trop proches de 0 ou 1).

---

## 2. Métriques de calibration — Définitions détaillées avec formules

### 2.1 Expected Calibration Error (ECE)

**Définition :** L'ECE mesure l'écart moyen entre la confiance prédite et l'accuracy observée, regroupé par bins de probabilité.

**Formule :**

```
ECE = Σⱼ₌₁ᴮ (nⱼ / N) × |acc(j) - conf(j)|
```

Où :
- B = nombre de bins (typiquement 10 ou 15)
- nⱼ = nombre de prédictions dans le bin j
- N = nombre total de prédictions
- acc(j) = accuracy observée dans le bin j (fréquence de succès)
- conf(j) = confiance moyenne prédite dans le bin j

**Interprétation :**
- ECE = 0 : calibration parfaite (idéal, jamais atteint en pratique).
- ECE = 0.05 : excellente calibration.
- ECE = 0.10 : calibration acceptable.
- ECE > 0.15 : calibration problématique.
- ECE → 1.0 :完全没有校准 / aucune calibration.

**Problème connu :** L'ECE dépend du nombre de bins B. Avec trop peu de bins, on masque le miscalibrage local. Avec trop de bins, chaque bin contient trop peu de prédictions et la variance explose. La pratique standard est B = 10 ou B = √N.

### 2.2 Maximum Calibration Error (MCE)

**Définition :** Le MCE mesure le **pire** écart de calibration sur un bin.

**Formule :**

```
MCE = maxⱼ₌₁ᴮ |acc(j) - conf(j)|
```

**Interprétation :**
- MCE est un upper bound sur l'erreur de calibration.
- Un MCE élevé indique qu'il existe au moins un intervalle de confiance où le modèle est très mal calibré.
- MCE ≥ ECE toujours (par définition).

**Utilité :** MCE est plus sensible aux outliers de calibration. Si ECE est bon mais MCE est élevé, le modèle est bien calibré en moyenne mais possède des « points aveugles » où la calibration est très mauvaise.

### 2.3 Brier Score

**Définition :** Le Brier Score est la moyenne des carrés des écarts entre les probabilités prédites et les résultats observés (one-hot encoded).

**Formule (classification multi-classe) :**

```
Brier = (1/N) × Σᵢ₌₁ᴺ Σⱼ₌₁ᶜ (pᵢⱼ - yᵢⱼ)²
```

Où :
- C = nombre de classes (3 pour football : domicile, nul, extérieur)
- pᵢⱼ = probabilité prédite pour la classe j du match i
- yᵢⱼ = 1 si le résultat réel est j, 0 sinon

**Décomposition de Murphy :**

```
Brier = Uncertainty - Resolution + Reliability
```

- **Uncertainty** : variance intrinsèque des résultats (irréductible).
- **Resolution** : capacité du modèle à séparer les prédictions en groupes de fréquences différentes (plus = meilleur).
- **Reliability** : erreur de calibration (plus = pire).

Un modèle avec bon Resolution mais mauvaise Reliability a des prédictions discriminantes mais mal calibrées. La calibration (Platt, isotonique) améliore la Reliability sans affecter la Resolution.

**Interprétation :**
- Brier = 0 : prédictions parfaites (probabilité 1 pour la bonne classe).
- Brier = 1 : pire prédictions possibles (probabilité 1 pour la mauvaise classe).
- Pour 3 classes, Brier aléatoire ≈ 0.667 (1 - 1/C).

### 2.4 Log Loss (Cross-Entropy)

**Définition :** Le Log Loss mesure la vraisemblance négative moyenne des prédictions.

**Formule :**

```
LogLoss = -(1/N) × Σᵢ₌₁ᴺ Σⱼ₌₁ᶜ yᵢⱼ × log(pᵢⱼ)
```

**Interprétation :**
- Log Loss = 0 : prédictions parfaites.
- Log Loss = ∞ : le modèle a assigné probabilité 0 à la classe correcte (catastrophique).
- Log Loss pénalise **exponentiellement** les probabilités mal placées : être confiant à 99% quand on a tort coûte beaucoup plus que d'être à 60%.
- C'est la métrique la plus stricte pour évaluer la qualité probabiliste.

**Différence avec Brier :** Le Log Loss est plus sensible aux erreurs extrêmes (probabilité proche de 0 pour la classe correcte). Le Brier Score est plus robuste mais moins discriminant.

### 2.5 État de calcul actuel

| Métrique | Abréviation | État | Valeur actuelle |
|---|---|---|---|
| Expected Calibration Error | ECE | ❌ JAMAIS CALCULÉ | INCONNU |
| Maximum Calibration Error | MCE | ❌ JAMAIS CALCULÉ | INCONNU |
| Brier Score | — | ❌ JAMAIS CALCULÉ | INCONNU |
| Log Loss (Cross-Entropy) | — | ❌ JAMAIS CALCULÉ | INCONNU |
| Diagramme de fiabilité | — | ❌ JAMAIS PRODUIT | INCONNU |

---

## 3. Diagrammes de fiabilité (Reliability Diagrams)

### 3.1 Principe

Un diagramme de fiabilité est la représentation graphique de la calibration d'un modèle. Il compare, pour chaque niveau de confiance prédit, la fréquence observée de succès.

**Construction :**

1. Diviser l'espace des probabilités prédites en B bins équidistants (ex: [0, 0.1], [0.1, 0.2], ..., [0.9, 1.0]).
2. Pour chaque bin j, calculer :
   - conf(j) = moyenne des probabilités prédites dans le bin.
   - acc(j) = fréquence observée de succès dans le bin.
3. Tracer les points (conf(j), acc(j)) sur un graphique.
4. Tracer la diagonale y = x (calibration parfaite).

### 3.2 Interprétation visuelle

```
Fréquence observée
1.0 |                    •  (sur-confiant à haute proba)
    |                 •
    |              •
    |           •
0.5 |        •           ← point bien calibré (proche diagonale)
    |     •
    |  •                 (sous-confiant à basse proba)
    |•
0.0 +─────────────────── Confiance prédite
    0.0              1.0
    ─ ─ ─ diagonale (calibration parfaite)
```

- **Points au-dessus de la diagonale** : le modèle est **sous-confiant** (il sous-estime sa propre précision).
- **Points en dessous de la diagonale** : le modèle est **sur-confiant** (il surestime sa propre précision).
- **Points sur la diagonale** : calibration parfaite.

### 3.3 Ce que le diagramme montrerait pour VirtuMatch

Sans calcul, on ne peut pas tracer le diagramme. Cependant, l'expérience avec des modèles similaires (combinaisons linéaires de signaux non optimisées pour la calibration) suggère que :

- Le modèle est probablement **sur-confiant** dans les probabilités élevées (> 70%).
- Le modèle est probablement **mal calibré** dans les probabilités faibles (< 40%) car ces probabilités sont rares et donc sous-représentées.
- La plage de confiance (25%–82%) est artificiellement contrainte par des caps (`CONF_MAX_BASE = 68`, `CONF_CAP = 82`), ce qui empêche la calibration de refléter la véritable incertitude.

---

## 4. Méthodes de calibration — Explications détaillées

### 4.1 Platt Scaling (1999)

**Principe :** Ajuster une régression logistique aux scores bruts du modèle pour produire des probabilités calibrées.

**Formule :**

```
p_calibrée = 1 / (1 + exp(A × x + B))
```

Où x est le score brut (ou log-probabilité) du modèle, et A, B sont appris sur les données de VALIDATION.

**Avantages :**
- Simple (2 paramètres).
- Préserve le ranking (monotone).
- Fonctionne bien quand le miscalibrage est principalement dû à un décalage de température (over/under-confidence).

**Inconvénients :**
- Suppose un miscalibrage de type sigmoïde — ne capture pas les non-linéarités complexes.
- Peut produire des probabilités écrasées vers 0.5 si les données de validation sont petites.

**Quand l'utiliser :** Quand le modèle est déjà quasi-calibré mais sur/under-confiant (le cas le plus courant pour les modèles neuronaux et les modèles linéaires).

### 4.2 Régression Isotonique (Zadrozny & Elkan, 2001)

**Principe :** Ajuster une fonction monotone non-paramétrique (escalier) aux scores bruts pour produire des probabilités calibrées.

**Algorithme :** Pool Adjacent Violators Algorithm (PAV) :
1. Trier les prédictions par score brut croissant.
2. Calculer la fréquence observée pour chaque score unique.
3. Fusionner les bins adjacents qui violent la monotonie.
4. Répéter jusqu'à convergence.

**Avantages :**
- Non-paramétrique — ne suppose aucune forme fonctionnelle.
- Capture les non-linéarités de calibration.
- Garantit la monotonie.

**Inconvénients :**
- Peut sur-ajuster si peu de données (crée trop de steps).
- Ne généralise pas bien aux scores en dehors de la plage vue à l'entraînement.
- Produit des probabilités « en escalier » (discontinues).

**Quand l'utiliser :** Quand le miscalibrage est complexe et non-sigmoïde. Quand on a beaucoup de données de validation (> 1 000 prédictions).

### 4.3 Calibration Beta (Kull et al., 2017)

**Principe :** Modéliser la relation entre score brut et fréquence observée par une distribution Beta paramétrique.

**Formule :**

```
p_calibrée = Beta(a × x + b ; α, β)
```

Où a, b, α, β sont 4 paramètres appris sur VALIDATION.

**Avantages :**
- Plus flexible que Platt (4 paramètres vs 2).
- Peut capturer des courbes de calibration non-sigmoïdes.
- Reste paramétrique (risque de surapprentissage modéré).

**Inconvénients :**
- Plus complexe à implémenter (optimisation de 4 paramètres).
- Risque de surapprentissage sur petites données.
- Moins bien compris théoriquement que Platt ou isotonique.

**Quand l'utiliser :** Quand Platt et isotonique sont insuffisants et qu'on a assez de données (> 2 000 prédictions).

### 4.4 Temperature Scaling (Guo et al., 2017)

**Principe :** Cas particulier de Platt Scaling où seul le paramètre de température T est ajusté (A = 1/T, B = 0).

**Formule :**

```
p_calibrée = softmax(logits / T)
```

**Avantages :**
- Ultra-simple (1 paramètre).
- Préserve le ranking et les ratios de probabilité.
- Très peu de risque de surapprentissage.

**Inconvénients :**
- Ne peut corriger que le sur/under-confidence global.
- Ne corrige pas les miscalibrages locaux.

**Quand l'utiliser :** Première chose à essayer. Souvent suffisante pour les réseaux neuronaux bien entraînés.

### 4.5 État d'implémentation actuel

| Méthode | État | Complexité | Données min. |
|---|---|---|---|
| Platt Scaling | ❌ Non implémentée | 2 paramètres | ~200 prédictions |
| Régression Isotonique | ❌ Non implémentée | Non-paramétrique | ~1 000 prédictions |
| Calibration Beta | ❌ Non implémentée | 4 paramètres | ~2 000 prédictions |
| Temperature Scaling | ❌ Non implémentée | 1 paramètre | ~100 prédictions |
| Histogramme de calibration | ❌ Non implémentée | B bins | ~50 par bin |

---

## 5. Pourquoi la calibration doit être entraînée sur TRAIN/VALIDATION uniquement

### 5.1 Règle fondamentale

**La calibration ne doit JAMAIS être ajustée sur les données de TEST.** Si on calibre sur les données de test, on commet une fuite d'information qui invalide les métriques d'évaluation.

### 5.2 Pipeline correct

```
TRAIN ──────► Entraînement du modèle (coefficients, poids)
                    │
                    ▼
VALIDATION ──► Calibration (Platt, isotonique, etc.)
                    │
                    ▼
TEST ────────► Évaluation finale (ECE, Brier, Log Loss)
```

### 5.3 Erreur courante

Une erreur fréquente consiste à ajuster la calibration sur **toutes** les données (train + validation + test), puis à rapporter les métriques de calibration sur ce même ensemble. Cela produit des métriques de calibration **artificiellement bonnes** qui ne se reproduiront pas en production.

### 5.4 Dans le cadre walk-forward

Pour chaque fenêtre du backtest walk-forward :

1. Entraîner le modèle sur TRAIN (coefficients, poids).
2. Prédire sur VALIDATION (scores bruts).
3. Ajuster la calibration sur VALIDATION (Platt/isotonique sur scores bruts vs résultats réels).
4. Prédire sur TEST (scores bruts → appliquer calibration → probabilités calibrées).
5. Évaluer ECE, Brier, Log Loss sur TEST (probabilités calibrées vs résultats réels).

---

## 6. Exemple : Modèle calibré vs Modèle non calibré

### 6.1 Scénario

Supposons 1 000 prédictions de matchs de football. Le modèle produit des scores de confiance bruts entre 0 et 1.

### 6.2 Modèle non calibré (VirtuMatch actuel — hypothèse)

| Bin de confiance | Prédictions | Confiance moy. | Accuracy observée | Écart |
|---|---|---|---|---|
| [0.2, 0.3] | 50 | 0.25 | 0.35 | +0.10 (sous-confiant) |
| [0.3, 0.4] | 120 | 0.35 | 0.42 | +0.07 |
| [0.4, 0.5] | 200 | 0.45 | 0.48 | +0.03 |
| [0.5, 0.6] | 250 | 0.55 | 0.52 | -0.03 |
| [0.6, 0.7] | 200 | 0.65 | 0.58 | -0.07 |
| [0.7, 0.8] | 130 | 0.75 | 0.60 | -0.15 (sur-confiant) |
| [0.8, 0.9] | 50 | 0.85 | 0.62 | -0.23 (très sur-confiant) |

**ECE estimé :** ~0.10 (problématique)
**Observation :** Le modèle est sur-confiant aux hautes probabilités. Quand il dit 85%, il n'a raison que 62% du temps.

### 6.3 Modèle calibré (après Platt Scaling)

| Bin de confiance | Prédictions | Confiance moy. | Accuracy observée | Écart |
|---|---|---|---|---|
| [0.2, 0.3] | 50 | 0.28 | 0.30 | +0.02 |
| [0.3, 0.4] | 120 | 0.38 | 0.40 | +0.02 |
| [0.4, 0.5] | 200 | 0.46 | 0.47 | +0.01 |
| [0.5, 0.6] | 250 | 0.53 | 0.52 | -0.01 |
| [0.6, 0.7] | 200 | 0.62 | 0.61 | -0.01 |
| [0.7, 0.8] | 130 | 0.68 | 0.67 | -0.01 |
| [0.8, 0.9] | 50 | 0.74 | 0.73 | -0.01 |

**ECE estimé :** ~0.01 (excellent)
**Observation :** Après calibration, la confiance correspond à la fréquence observée. « 74% de confiance » signifie vraiment ~74% de chances de succès.

---

## 7. Déficits identifiés — Synthèse

| Déficit | Gravité | Détail | Impact |
|---|---|---|---|
| ECE jamais calculé | CRITIQUE | Impossible de quantifier le miscalibrage | Confiance décorative |
| MCE jamais calculé | ÉLEVÉ | Points aveugles de calibration non détectés | Sur-confiance locale |
| Brier Score jamais calculé | CRITIQUE | Aucune mesure de qualité probabiliste | Pas de décomposition Murphy |
| Log Loss jamais calculé | ÉLEVÉ | Aucune pénalisation pour confiance mal placée | Erreurs extrêmes non pénalisées |
| Diagramme de fiabilité absent | ÉLEVÉ | Aucun diagnostic visuel du miscalibrage | Diagnostic impossible |
| Aucune méthode de calibration | CRITIQUE | Scores décoratifs, pas informatifs | Utilisateur trompé |
| Risque utilisateur | ÉLEVÉ | Confiance interprétée comme probabilité | Décisions erronées |
| Pas de calibration sur VALIDATION | CRITIQUE | Si calibration implémentée sans split, fuite | Métriques artificielles |

---

## 8. Recommandation détaillée

### 8.1 Étape 1 : Collecte des données

- **Extraire** de la base Neon DB toutes les prédictions vérifiées (résultat connu).
- **Vérifier** que `prediction_date < match_date` pour chaque prédiction.
- **Séparer** en ensembles TRAIN / VALIDATION / TEST par ordre temporel.

### 8.2 Étape 2 : Calcul des métriques de calibration

- Calculer **ECE** (10 bins) sur l'ensemble VALIDATION.
- Calculer **MCE** sur VALIDATION.
- Calculer **Brier Score** (avec décomposition de Murphy si possible).
- Calculer **Log Loss**.
- Produire le **diagramme de fiabilité**.

### 8.3 Étape 3 : Calibration

- Appliquer **Temperature Scaling** en premier (simple, baseline).
- Appliquer **Platt Scaling** (plus flexible, 2 paramètres).
- Si données suffisantes (> 1 000), appliquer **Régression Isotonique**.
- **Toujours** ajuster sur VALIDATION uniquement, jamais sur TEST.

### 8.4 Étape 4 : Validation

- Évaluer ECE, MCE, Brier, Log Loss **après calibration** sur TEST.
- Comparer avant/après calibration.
- Rapporter les résultats dans un tableau :

```
                    Avant calibration    Après Temp.    Après Platt    Après Isotonique
ECE                 0.10                 0.04           0.03           0.02
MCE                 0.23                 0.08           0.06           0.04
Brier Score         0.65                 0.58           0.56           0.55
Log Loss            1.02                 0.85           0.82           0.80
```

---

## 9. Conclusion

Les scores de confiance du VirtuMatch Predictor sont **des heuristiques non calibrées** sans aucune interprétation probabiliste démontrée. Quand le modèle affiche « confiance = 70 % », il est **impossible** de savoir si cela correspond à 70 %, 50 % ou 30 % de succès réel. Aucune des quatre métriques de calibration (ECE, MCE, Brier, Log Loss) n'a jamais été calculée. Aucune méthode de calibration n'est implémentée.

**L'état actuel est CALIBRATION NON PROUVÉE.** L'utilisateur est potentiellement trompé par des scores de confiance qui ressemblent à des probabilités mais n'en sont pas.

---

*Ce rapport doit être mis à jour après l'implémentation du calcul de calibration (FIX-V3-06) et des méthodes de calibration (FIX-V3-11).*
