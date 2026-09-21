# Rapport d'Audit — Étude d'Ablation

**Projet :** VirtuMatch Predictor
**Date :** 2026-03-05
**Statut :** ❌ ABLATION NON PROUVÉE
**Auditeur :** Audit automatique approfondi
**Référence standard :** Masegosa (2020), Mentch & Hooker (2016), Covert et al. (2020)

---

## 1. Méthodologie d'ablation — Explication détaillée

### 1.1 Principe

Une étude d'ablation (ablation study) consiste à **retirer systématiquement chaque composant** d'un modèle et à mesurer la perte de performance qui en résulte. C'est la méthode standard pour déterminer :

1. **Quels composants apportent un signal utile** (performance diminue quand on les retire).
2. **Quels composants ajoutent du bruit** (performance augmente quand on les retire).
3. **Quels composants sont redondants** (performance ne change pas quand on les retire).

### 1.2 Méthodologie formelle

Soit M le modèle complet avec tous les composants {C₁, C₂, ..., Cₖ}. Pour chaque composant Cᵢ :

```
Δ(Cᵢ) = Performance(M) - Performance(M \ Cᵢ)
```

- **Δ > 0** : Cᵢ est utile (le modèle est meilleur avec ce composant).
- **Δ ≈ 0** : Cᵢ est redondant (n'ajoute pas d'information au-delà des autres).
- **Δ < 0** : Cᵢ est nuisible (ajoute du bruit, le modèle est meilleur sans).

### 1.3 Ablation conditionnelle (leave-one-in)

L'ablation classique (leave-one-out) peut masquer des redondances. L'ablation conditionnelle teste chaque composant **seul** :

```
Δ_cond(Cᵢ) = Performance(Cᵢ seul) - Performance(baseline vide)
```

Si un composant performe bien seul mais mal avec d'autres, il y a **interaction négative** (redondance ou conflit).

### 1.4 Pourquoi l'ablation est critique pour VirtuMatch

VirtuMatch combine **6 composants hétérogènes** (IA, H2H, Form, Momentum, Anti-trap, Stats) avec des poids arbitraires. Sans ablation :

- On ne sait pas si l'IA améliore la prédiction ou si elle ne fait que dupliquer l'information déjà présente dans Stats.
- On ne sait pas si Momentum est un signal indépendant ou un double comptage de Form.
- On ne sait pas si l'Anti-trap filtre les mauvaises prédictions ou supprime les bonnes.
- On ne sait pas si les 6 composants sont meilleurs que 3 ou 4 d'entre eux.

---

## 2. Composants à ablater — Analyse détaillée

### 2.1 IA (AI_WEIGHT = 0.35)

**Description :** Analyse par modèle de langage (LLM) qui génère une prédiction textuelle convertie en probabilité.

**Poids dans le modèle :** `AI_WEIGHT = 0.35` — le plus élevé de tous les composants.

**Pourquoi ce poids est arbitraire :**
- 0.35 n'est pas le résultat d'une optimisation. Il a été choisi par le développeur.
- Aucun grid search, aucune validation croisée, aucun critère informationnel n'a été utilisé.
- La valeur 0.20 ou 0.50 pourrait être meilleure ou pire — on ne sait pas.

**Contribution théorique :**
- Un LLM peut capturer des informations qualitatives (blessures, motivation, contexte) non disponibles dans les statistiques quantitatives.
- **Mais** un LLM peut aussi halluciner ou reproduire des biais de son entraînement.

**Risques :**
- **Signal non orthogonal** : le LLM a été entraîné sur des données sportives qui incluent les mêmes statistiques que le composant Stats. Il pourrait simplement reproduire le signal de Stats sous forme textuelle.
- **Non-déterminisme** : les LLMs produisent des résultats variables (temperature > 0). La même input peut donner des prédictions différentes.
- **Coût computationnel** : chaque appel au LLM coûte de l'argent et du temps.
- **Hypothèse d'ablation** : retirer l'IA pourrait avoir un impact neutre (signal dupliqué) ou positif (bruit supprimé).

### 2.2 H2H (Face-à-Face)

**Description :** Historique des confrontations directes entre deux équipes.

**Poids :** `H2H_HOME_BOOST = 0.5`, `H2H_AWAY_PENALTY = 0.3`, `H2H_BIAS_DIVISOR = 200`.

**Problème de l'échantillon faible :**
- Deux équipes se rencontrent en moyenne 2 fois par saison dans la même ligue.
- Sur 5 saisons, cela fait ~10 confrontations directes.
- **10 observations est un échantillon catastrophiquement faible** pour estimer une probabilité. L'intervalle de confiance à 95 % pour une proportion sur n=10 est ±0.31 (presque aussi large que la probabilité elle-même).
- Pour les équipes de ligues différentes (rencontres internationales), l'échantillon est encore plus faible (0-3 matchs).

**Biais domicile/extérieur :**
- `H2H_HOME_BOOST = 0.5` suppose que le H2H à domicile mérite un bonus de 0.5. Cette valeur n'est pas calibrée sur les données réelles.
- L'avantage domicile dans le football est estimé à ~0.3-0.4 buts en moyenne, mais cette valeur varie par ligue et par époque.
- Le H2H confond deux effets : (1) la supériorité intrinsèque d'une équipe, et (2) l'avantage domicile. Sans déconfondre, le H2H surestime l'un ou l'autre.

**Risques :**
- **Haute variance** : avec n=10, le H2H est essentiellement du bruit.
- **Poids arbitraires** : H2H_HOME_BOOST, H2H_AWAY_PENALTY, H2H_BIAS_DIVISOR ne sont pas optimisés.
- **Hypothèse d'ablation** : retirer le H2H pourrait améliorer la performance (réduction de bruit).

### 2.3 Form (Forme récente)

**Description :** Performances des 5 derniers matchs de chaque équipe.

**Poids :** `FORM_ATTACK_BOOST = 0.15`, `FORM_DEFENSE_PENALTY = 0.10`, `FORM_AGREEMENT_THRESHOLD = 15`.
**Fenêtre :** 5 matchs (poids : [1.5, 1.3, 1.2, 1.1, 1.0]).

**Pourquoi 5 matchs est arbitraire :**
- La fenêtre de 5 matchs n'est pas optimisée. La « bonne » fenêtre dépend de la ligue, de la fréquence des matchs, et de la dynamique des équipes.
- En football, une fenêtre de 5 matchs représente ~3-5 semaines. C'est potentiellement trop court pour capturer une tendance stable, ou trop long pour capturer un changement récent (blessure, transfert).
- Des études académiques (Dixon-Coles, Rue-Salvesen) utilisent un facteur de décroissance exponentielle ρ^t optimisé par maximum de vraisemblance, typiquement ρ ≈ 0.005-0.01 par jour.

**Biais de récence :**
- Les poids [1.5, 1.3, 1.2, 1.1, 1.0] donnent 50% plus de poids au match le plus récent qu'au plus ancien. Ce ratio n'est pas justifié.
- Le biais de récence peut amplifier les fluctuations aléatoires : une équipe qui gagne 2 matchs par chance voit sa forme artificiellement gonflée.

**Corrélation avec Momentum :**
- Form et Momentum sont calculés à partir des **mêmes données** (résultats récents). Momentum est une **transformation monotone** de Form.
- Par conséquent, Momentum n'apporte **aucune information supplémentaire** au-delà de Form. C'est du double comptage.
- Ce double comptage gonfle artificiellement l'importance de la forme récente dans le modèle final.

**Risques :**
- **Fenêtre arbitraire** : 5 matchs n'est pas optimal.
- **Double comptage avec Momentum** : la forme récente est comptée deux fois.
- **Corrélation avec les cotes** : les bookmakers intègrent déjà la forme récente dans leurs cotes. Le signal de Form pourrait être redondant avec les cotes implicites.
- **Hypothèse d'ablation** : retirer Form pourrait avoir un impact modéré (signal partiellement dupliqué par Momentum et les cotes).

### 2.4 Momentum

**Description :** Indicateur dérivé de la forme récente (tendance : amélioration ou dégradation).

**Problème fondamental — PAS un signal indépendant :**

Momentum est calculé à partir des mêmes données que Form. Spécifiquement :

```
Momentum = f(résultats_récents)  où résultats_récents = données de Form
```

Puisque Momentum = f(Form), l'information de Momentum est **entièrement contenue** dans Form. Momentum n'ajoute **aucun bit d'information** au-delà de Form.

**Double comptage explicite :**

Dans le modèle VirtuMatch, la confiance est calculée comme une combinaison de plusieurs signaux, dont Form et Momentum. Puisque Momentum = f(Form), l'effet de la forme récente est compté **deux fois** :

```
Confiance ∝ ... + w_form × Form + w_momentum × Momentum + ...
                ╰─── signal Form ───╯   ╰── signal Form (again) ───╯
```

**Risques :**
- **Double comptage** : la forme récente est sur-représentée dans le modèle.
- **Pas de signal indépendant** : Momentum est redondant par construction.
- **Variance amplifiée** : le double comptage amplifie les fluctuations aléatoires de la forme.
- **Hypothèse d'ablation** : retirer Momentum ne devrait pas réduire la performance (signal déjà capturé par Form). Si retirer Momentum améliore la performance, cela confirme le double comptage.

### 2.5 Anti-trap

**Description :** Mécanisme de détection des « pièges à paris » — situations où les cotes semblent attractives mais sont trompeuses.

**Critères (5 conditions) :**
1. Écart entre prédiction du modèle et cotes de marché.
2. Mouvement récent des cotes.
3. Volume de paris asymétrique.
4. Convergence/divergence des signaux internes.
5. Contexte de la ligue/saison.

**Pourquoi c'est une hypothèse, pas un fait :**
- L'Anti-trap suppose que les cotes de marché peuvent être « trompeuses » et que le modèle peut détecter ces situations. C'est une hypothèse **forte** non validée.
- Les bookmakers ajustent leurs cotes pour maximiser leur profit, pas pour refléter les probabilités réelles. Mais ils ont accès à plus d'information que le modèle VirtuMatch (insiders, volume de paris, modèles propriétaires).
- L'hypothèse que VirtuMatch peut « battre » les bookmakers sur l'identification des pièges est **non prouvée**.

**Absence de métriques de performance :**
- **Précision** : parmi les matchs identifiés comme « pièges », quelle proportion étaient réellement des pièges ? **JAMAIS CALCULÉE.**
- **Rappel** : parmi les vrais pièges, quelle proportion ont été détectés ? **JAMAIS CALCULÉ.**
- **Lift** : le filtre anti-trap améliore-t-il la performance des prédictions restantes ? **JAMAIS CALCULÉ.**
- **Faux positifs** : combien de bonnes prédictions sont supprimées à tort ? **JAMAIS CALCULÉ.**

**Risques :**
- **Faux positifs** : le filtre pourrait supprimer de bonnes prédictions (plus destructif qu'utile).
- **Faux négatifs** : le filtre pourrait laisser passer de vrais pièges.
- **Biais de confirmation** : on se souvient des pièges évités, pas des bonnes prédictions supprimées.
- **Hypothèse d'ablation** : retirer l'Anti-trap pourrait améliorer ou dégrader la performance — on ne sait pas.

### 2.6 Stats (Statistiques)

**Description :** Buts marqués/encaissés, positions au classement, attaque/défense par équipe.

**Poids :** `STAT_BASE = 0.30`, `STAT_ATTACK = 0.40`, `STAT_DEF = 0.30` (somme = 1.0 ✅).

**Double comptage potentiel avec les cotes :**
- Les cotes des bookmakers sont déjà calculées à partir de modèles qui intègrent les buts marqués/encaissés, les positions, l'attaque/défense, etc.
- Les statistiques utilisées par VirtuMatch sont les **mêmes données** que celles utilisées par les bookmakers pour calculer leurs cotes.
- Par conséquent, le signal Stats est **partiellement redondant** avec les cotes implicites. VirtuMatch compte cette information deux fois : une fois via Stats, une fois via les cotes.

**Avantage potentiel :**
- Les statistiques de VirtuMatch pourraient capturer des informations plus récentes ou plus détaillées que les cotes (si les cotes sont ajustées lentement).
- Les statistiques de VirtuMatch pourraient corriger les biais de marge de profit des bookmakers (overround).

**Risques :**
- **Redondance avec cotes** : signal partiellement dupliqué.
- **Poids fixe** : les poids STAT_BASE/ATTACK/DEF ne sont pas optimisés.
- **Hypothèse d'ablation** : retirer Stats pourrait avoir un impact important (signal potentiellement le plus fort), mais ce signal pourrait être en grande partie capturé par les cotes.

---

## 3. Résultats d'ablation attendus (hypothèses, non prouvés)

### 3.1 Tableau hypothétique

Le tableau suivant présente les résultats **hypothétiques** de l'ablation, basés sur le raisonnement théorique ci-dessus. **Ces valeurs ne sont pas mesurées** et ne doivent pas être citées comme des résultats.

| Configuration | Accuracy (hyp.) | Log Loss (hyp.) | Brier (hyp.) | vs Complet |
|---|---|---|---|---|
| **Modèle complet** | 0.52 | 0.98 | 0.62 | Référence |
| Sans IA | 0.51 | 1.00 | 0.64 | -1% (IA signal faible ?) |
| Sans H2H | 0.53 | 0.96 | 0.60 | +2% (H2H = bruit ?) |
| Sans Form | 0.50 | 1.02 | 0.65 | -4% (Form = signal fort) |
| Sans Momentum | 0.52 | 0.98 | 0.62 | 0% (redondant avec Form) |
| Sans Anti-trap | 0.52 | 0.98 | 0.62 | 0% (impact neutre ?) |
| Sans Stats | 0.48 | 1.08 | 0.70 | -8% (Stats = signal le plus fort) |
| Stats seul | 0.50 | 1.01 | 0.64 | -4% (Stats est la base) |
| Cotes seules | 0.51 | 0.99 | 0.63 | -2% (cotes = baseline forte) |

### 3.2 Interprétation hypothétique

- **Stats** est probablement le composant le plus important (signal le plus riche).
- **H2H** est probablement nuisible (échantillon trop faible → bruit).
- **Momentum** est probablement redondant (Δ ≈ 0 par rapport à Form).
- **IA** a un impact incertain (pourrait être positif, neutre, ou négatif).
- **Anti-trap** a un impact incertain (pourrait améliorer ou dégrader).
- **Form** apporte probablement un signal modéré mais partiellement redondant avec Stats et les cotes.

### 3.3 Avertissement

**Ces hypothèses DOIVENT être vérifiées par une étude d'ablation réelle** sur données out-of-sample. Elles ne constituent pas des résultats.

---

## 4. Implémentation de l'étude d'ablation avec walk-forward

### 4.1 Design expérimental

Pour chaque fenêtre walk-forward (TRAIN → VALIDATION → TEST) :

1. **Modèle complet** : entraîner avec tous les composants, évaluer sur TEST.
2. **Sans IA** : entraîner avec `AI_WEIGHT = 0`, redistribuer le poids aux autres composants, évaluer sur TEST.
3. **Sans H2H** : désactiver le composant H2H, évaluer sur TEST.
4. **Sans Form** : désactiver Form et Momentum (redondants), évaluer sur TEST.
5. **Sans Momentum** : désactiver Momentum uniquement, évaluer sur TEST.
6. **Sans Anti-trap** : désactiver le filtre anti-trap, évaluer sur TEST.
7. **Sans Stats** : désactiver Stats, évaluer sur TEST.
8. **Composants seuls** : chaque composant individuellement (leave-one-in).

### 4.2 Redistribution des poids

Quand on retire un composant de poids w, les poids restants doivent être **renormalisés** pour sommer à 1 :

```
w'_i = w_i / (1 - w_retiré)  pour chaque composant i restant
```

Par exemple, si on retire l'IA (w = 0.35) :
- Somme restante = 1.0 - 0.35 = 0.65
- Nouveau poids Stats = STAT_WEIGHT / 0.65
- Nouveau poids Form = FORM_WEIGHT / 0.65
- etc.

### 4.3 Métriques à rapporter

Pour chaque configuration et chaque fenêtre :

| Métrique | Description |
|---|---|
| Accuracy | Taux de prédictions correctes |
| Log Loss | Cross-entropy |
| Brier Score | MSE probabiliste |
| ECE | Erreur de calibration |
| N | Nombre de prédictions dans la fenêtre TEST |

### 4.4 Tests de significativité

Pour chaque paire de configurations (complet vs ablation), effectuer :

1. **Test de McNemar** : compare les taux d'erreur de deux classifieurs sur les mêmes données.
2. **Test-t apparié** sur les Log Loss : compare les distributions de loss.
3. **Bootstrap** (10 000 itérations) : intervalle de confiance à 95 % sur la différence de performance.

### 4.5 Interactions entre composants

Après l'ablation individuelle, tester les interactions :

- **Sans IA + Sans H2H** : l'IA et le H2H sont-ils tous les deux utiles, ou l'un compense-t-il l'autre ?
- **Sans Form + Sans Momentum** : redondance confirmée ?
- **Sans Stats + Sans Cotes** : les deux signaux les plus forts sont-ils redondants ?

---

## 5. Déficits identifiés — Synthèse

| Déficit | Gravité | Détail | Impact |
|---|---|---|---|
| Aucune étude d'ablation | CRITIQUE | Contribution de chaque composant inconnue | Modèle non compris |
| AI_WEIGHT = 0.35 arbitraire | ÉLEVÉ | Pas validé empiriquement | Potentiel sur/sous-poids |
| H2H échantillon faible | ÉLEVÉ | ~10 confrontations → variance élevée | Probablement du bruit |
| H2H poids arbitraires | ÉLEVÉ | HOME_BOOST, AWAY_PENALTY non calibrés | Biais non quantifié |
| Form fenêtre = 5 arbitraire | MOYEN | Non optimisé | Fenêtre potentiellement sous-optimale |
| Form poids arbitraires | MOYEN | ATTACK_BOOST, DEFENSE_PENALTY | Biais non quantifié |
| Momentum redondant avec Form | ÉLEVÉ | Double comptage confirmé par construction | Forme sur-représentée |
| Anti-trap non validé | ÉLEVÉ | Aucune métrique (précision, rappel, lift) | Filtre potentiellement destructif |
| Stats redondant avec cotes | MOYEN | Mêmes données utilisées deux fois | Signal potentiellement dupliqué |
| Pas d'interaction testée | ÉLEVÉ | Effets combinés inconnus | Synergies/antagonismes non détectés |

---

## 6. Recommandation détaillée

### 6.1 Implémentation de l'ablation

1. **Créer** un module `ablation-study.ts` qui automatise le retrait de chaque composant.
2. **Intégrer** avec le framework walk-forward (FIX-V3-05).
3. **Exécuter** l'ablation complète (7 configurations × N fenêtres).
4. **Calculer** les métriques out-of-sample pour chaque configuration.
5. **Effectuer** les tests de significativité (McNemar, bootstrap).
6. **Rapporter** les résultats dans un tableau comparatif.

### 6.2 Résolution du double comptage Momentum ↔ Form

- **Option A** : Supprimer Momentum (signal redondant par construction).
- **Option B** : Supprimer Form et garder Momentum uniquement (si Momentum capture un signal différent).
- **Option C** : Fusionner Form et Momentum en un seul composant avec un seul poids.
- **Recommandation** : Option A (supprimer Momentum), car Momentum = f(Form) par construction.

### 6.3 Validation de l'Anti-trap

- Calculer **précision**, **rappel**, **lift** et **faux positifs** du filtre anti-trap.
- Si le lift < 1.0 (le filtre dégrade la performance), le désactiver.
- Si le lift > 1.0 mais le rappel est faible, optimiser les seuils.

### 6.4 Validation du H2H

- Comparer le modèle avec et sans H2H.
- Si le H2H dégrade la performance (Δ < 0), le supprimer.
- Si le H2H améliore la performance, restreindre son utilisation aux paires d'équipes avec ≥ 10 confrontations (réduire la variance).

---

## 7. Conclusion

Sans étude d'ablation, il est **impossible de déterminer si les composants du VirtuMatch Predictor ajoutent de l'information ou du bruit**. L'analyse théorique suggère que :

- **Momentum** est redondant avec Form (double comptage confirmé par construction).
- **H2H** est probablement nuisible (échantillon trop faible).
- **Stats** est probablement le signal le plus fort mais partiellement redondant avec les cotes.
- **IA** a un impact incertain (signal non validé).
- **Anti-trap** a un impact incertain (aucune métrique calculée).

**L'état actuel est ABLATION NON PROUVÉE.** Seule une étude d'ablation out-of-sample dans le cadre walk-forward peut confirmer ou infirmer ces hypothèses.

---

*Ce rapport doit être mis à jour après l'implémentation de l'étude d'ablation (FIX-V3-10).*
