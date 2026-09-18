# Rapport d'Audit — Backtest Walk-Forward

**Projet :** VirtuMatch Predictor
**Date :** 2026-03-05
**Statut :** ❌ BACKTEST NON PROUVÉ
**Auditeur :** Audit automatique approfondi
**Référence standard :** Dixon-Coles (1997), Koopman & Lit (2017), Rue & Salvesen (2000)

---

## 1. État actuel — Analyse détaillée

### 1.1 Constat principal

**Aucun backtest walk-forward n'existe dans le projet VirtuMatch Predictor.** Cette absence constitue la faille la plus grave du système de prédiction : sans validation out-of-sample rigoureuse, toutes les métriques de performance rapportées sont dépourvues de valeur prédictive démontrée.

### 1.2 Analyse du script existant

Le fichier `scripts/backtest_prediction_engine.js` est présent dans le dépôt, mais il ne constitue **pas un véritable framework de backtest**. Après analyse du code, les limitations suivantes ont été identifiées :

- **Pas de séparation temporelle** : le script ne divise pas les données en ensembles train/validation/test avec une contrainte temporelle stricte (données passées → entraînement, données futures → évaluation).
- **Pas d'interdiction de fuite future** : rien ne garantit que les informations postérieures à la date de prédiction (résultats du match, performances ultérieures des équipes) ne sont pas utilisées pour calculer les features.
- **Pas d'accumulation rolling** : les fenêtres d'entraînement ne grandissent pas de manière rolling (les données les plus anciennes ne sont pas retirées au fur et à mesure).
- **Pas de métriques out-of-sample** : le script ne calcule aucune métrique sur des données non vues pendant la phase d'optimisation.
- **Pas de comparaison avec baselines** : aucune baseline (cotes implicites, Poisson, majorité) n'est calculée en parallèle.

### 1.3 Pourquoi le script actuel est insuffisant

Un script de backtest qui ne respecte pas l'ordre temporel des données commet une erreur fondamentale : il permet au modèle de « voir le futur » lors de l'entraînement, ce qui gonfle artificiellement les performances. En finance, ceci est appelé **look-ahead bias** ; en machine learning, c'est le **data snooping bias**. Dans le contexte de la prédiction sportive, les conséquences sont identiques :

- Les métriques rapportées sont **optimistes** et ne se reproduiront pas en production.
- Les coefficients optimisés sur données contaminées **généraliseront mal** sur de nouvelles saisons.
- Toute conclusion sur la supériorité du modèle est **infondée** sans évaluation out-of-sample.

---

## 2. Spécification du framework walk-forward requis

### 2.1 Principe fondamental

Le backtest walk-forward simule le déploiement réel du modèle : à chaque pas de temps, le modèle est entraîné sur les données disponibles à ce moment, puis évalué sur les données futures (que le modèle n'a pas encore vues). C'est la seule méthodologie qui garantit l'absence de fuite d'information future.

### 2.2 Split temporel — Architecture

```
┌─────────────────── Temps ──────────────────────►

   [TRAIN]    [VALID]  [TEST]                          
   ├──────────┤────────┤──────┤  Fenêtre 1              
   ├───────────────┤────────┤──────┤  Fenêtre 2        
   ├────────────────────┤────────┤──────┤  Fenêtre 3   
   ...                                          
   ├──────────────────────────────┤────────┤──────┤  Fenêtre N
                                   ↑                           
                        Évaluation OOS uniquement               
```

**Règles strictes :**

1. **TRAIN** : données de la saison S-k à S-2 (k saisons historiques).
2. **VALIDATION** : saison S-1 (optimisation des hyperparamètres et coefficients).
3. **TEST** : saison S (évaluation finale, **jamais utilisée pour l'optimisation**).
4. **Fenêtre glissante** : après évaluation de la saison S, la fenêtre avance : TRAIN ← S-(k-1) à S-1, VALID ← S, TEST ← S+1.
5. **Interdiction absolue** : aucune donnée postérieure au début de TEST ne peut être utilisée pour calculer des features, des poids, ou des coefficients.

### 2.3 Règle d'interdiction des données futures (Forbidden Future Data)

Pour chaque match M prédict à la date T :

| Source de données | Autorisée si | Interdite si |
|---|---|---|
| Résultats antérieurs à T | ✅ Toujours | — |
| Résultats de M | — | ❌ Toujours |
| Résultats postérieurs à T | — | ❌ Toujours |
| Cotes de marché au temps T | ✅ Si disponibles à T | ❌ Si cotes post-match |
| Statistiques agrégées incluant M | — | ❌ Toujours |
| Forme calculée sur matchs postérieurs à T | — | ❌ Toujours |

Cette règle doit être vérifiée **automatiquement** par le framework, pas manuellement.

---

## 3. Schéma de données requis

### 3.1 Table des prédictions (predictions_verified)

```sql
CREATE TABLE predictions_verified (
    id              UUID PRIMARY KEY,
    match_id        UUID NOT NULL REFERENCES matches(id),
    model_version   VARCHAR(32) NOT NULL,       -- ex: "v1.2.3-wf-window-3"
    prediction_date TIMESTAMPTZ NOT NULL,        -- date de la prédiction
    match_date      TIMESTAMPTZ NOT NULL,        -- date du match (≥ prediction_date)
    
    -- Probabilités prédites (AVANT calibration)
    prob_home_raw   DECIMAL(5,4),
    prob_draw_raw   DECIMAL(5,4),
    prob_away_raw   DECIMAL(5,4),
    
    -- Probabilités calibrées (APRÈS calibration)
    prob_home_cal   DECIMAL(5,4),
    prob_draw_cal   DECIMAL(5,4),
    prob_away_cal   DECIMAL(5,4),
    
    -- Résultat réel
    actual_result   VARCHAR(10),                 -- 'home', 'draw', 'away'
    actual_home_goals INTEGER,
    actual_away_goals INTEGER,
    
    -- Métadonnées
    window_id       INTEGER NOT NULL,            -- fenêtre walk-forward
    split_type      VARCHAR(10) NOT NULL,        -- 'train', 'validation', 'test'
    
    -- Features utilisées (snapshot pour reproductibilité)
    features_snapshot JSONB
);
```

### 3.2 Contraintes d'intégrité

- `prediction_date < match_date` : la prédiction doit précéder le match.
- `prob_home + prob_draw + prob_away = 1.0` (tolérance ±0.001).
- Chaque prédiction doit avoir un `model_version` pour la reproductibilité.
- `split_type` est assigné par le framework, jamais manuellement.

---

## 4. Métriques à calculer par fenêtre temporelle

### 4.1 Métriques principales

| Métrique | Formule | Interprétation |
|---|---|---|
| **Accuracy** | (1/N) Σ 𝟙(ŷᵢ = yᵢ) | Taux de prédictions correctes (classe majoritaire) |
| **Log Loss** | -(1/N) Σ Σ yᵢⱼ · log(pᵢⱼ) | Pénalise les probabilités mal placées ; plus bas = meilleur |
| **Brier Score** | (1/N) Σ Σ (pᵢⱼ - yᵢⱼ)² | MSE des probabilités ; 0 = parfait, 1 = pire |
| **ECE** | Σⱼ (nⱼ/N) · |acc(j) - conf(j)| | Erreur de calibration attendue par bin |
| **MCE** | maxⱼ |acc(j) - conf(j)| | Pire erreur de calibration sur un bin |
| **ROI simulé** | (1/N) Σ (retourⱼ - miseⱼ) / miseⱼ | Rendement si on pariait selon le modèle |

### 4.2 Métriques par classe

Pour chaque classe c ∈ {Domicile, Nul, Extérieur} :

| Métrique | Description |
|---|---|
| Precision(c) | Parmi les prédictions de classe c, proportion correcte |
| Recall(c) | Parmi les vrais résultats de classe c, proportion détectée |
| F1(c) | Moyenne harmonique de Precision et Recall |

### 4.3 Métriques par fenêtre temporelle

Chaque métrique doit être calculée **par fenêtre walk-forward** pour détecter :

- **Dérive temporelle** : si la performance se dégrade sur les fenêtres les plus récentes.
- **Saisonnalité** : si certaines saisons sont systématiquement plus difficiles.
- **Stabilité** : si la variance inter-fenêtre est faible (modèle robuste) ou forte (modèle fragile).

### 4.4 Format de rapport

```
Fenêtre | Saison Test | N  | Accuracy | Log Loss | Brier | ECE  | ROI
--------|-------------|----|----------|----------|-------|------|-----
   1    | 2023-2024   | 380| 0.52     | 0.98     | 0.62  | 0.08 | +2.1%
   2    | 2024-2025   | 380| 0.49     | 1.02     | 0.65  | 0.11 | -1.3%
   ...
Moyenne | —           | —  | 0.505    | 1.00     | 0.635 | 0.095| +0.4%
Écart-type| —         | —  | 0.021    | 0.028    | 0.021 | 0.021| 2.4%
```

---

## 5. Exigences en données — Puissance statistique

### 5.1 Nombre minimum de matchs

Pour que les métriques de backtest soient statistiquement significatives, un nombre minimum de matchs est requis. Les estimations suivantes sont basées sur des intervalles de confiance à 95 % pour l'accuracy et le Brier score :

| Métrique | N min (par fenêtre) | N min (total OOS) | Justification |
|---|---|---|---|
| Accuracy (±2%) | 2 400 | 7 200 | Intervalle de Wilson pour proportion |
| Brier Score (±0.02) | 1 000 | 3 000 | Bootstrap CI sur variance |
| ECE (10 bins, ±0.05) | 5 000 | 15 000 | Au moins 500 par bin |
| Log Loss | 1 500 | 4 500 | Stabilité asymptotique |
| ROI (significatif) | 10 000 | 30 000 | Variance élevée des rendements |

### 5.2 Données disponibles

Estimation du volume de données dans la base Neon DB :

- ~380 matchs par saison × 5 ligues majeures = ~1 900 matchs/saison.
- Sur 3 saisons : ~5 700 matchs.
- **Verdict** : le volume est **suffisant pour Accuracy et Brier**, mais **insuffisant pour ECE** et **très insuffisant pour ROI**. Il faut either : (a) ajouter plus de ligues/saisons, ou (b) accepter des intervalles de confiance plus larges.

### 5.3 Recommandation de données

- **Minimum absolu** : 2 saisons complètes de TRAIN, 1 saison VALID, 1 saison TEST = 4 saisons × 1 900 = 7 600 matchs.
- **Recommandé** : 5 saisons TRAIN + 1 VALID + 1 TEST = 7 saisons × 1 900 = 13 300 matchs.
- **Idéal** : 8+ saisons pour des tests de significativité robustes sur ROI.

---

## 6. Comparaison avec les standards de backtesting publiés

### 6.1 Méthode Dixon-Coles (1997)

La méthode Dixon-Coles est le standard académique pour la modélisation des scores de football. Elle :

- Modélise les buts comme deux Poisson indépendantes avec des paramètres λ₁ et λ₂ dépendant de l'attaque et la défense de chaque équipe.
- Utilise un **facteur de décroissance temporelle** ρ^t pour pondérer les matchs passés (matchs récents = plus de poids).
- Estime les paramètres par **maximum de vraisemblance** sur des données historiques.
- A été **validée sur des milliers de matchs** avec des résultats publiés dans des revues à comité de lecture.

**Comparaison avec VirtuMatch** : VirtuMatch n'utilise ni maximum de vraisemblance, ni facteur de décroissance temporelle optimisé, ni validation sur un grand nombre de matchs. Les poids temporels de VirtuMatch (FORM_WEIGHTS = [1.5, 1.3, 1.2, 1.1, 1.0]) sont fixes et non optimisés.

### 6.2 Méthode Rue-Salvesen (2000)

Extension bayésienne de Dixon-Coles avec :

- Inférence bayésienne sur les paramètres d'attaque/défense.
- Mise à jour dynamique des distributions a posteriori après chaque match.
- Intervalles de crédibilité sur les probabilités prédites.

**Comparaison** : VirtuMatch ne fournit aucun intervalle de confiance sur ses prédictions. Les scores de confiance (25%–82%) ne sont pas des intervalles de crédibilité.

### 6.3 Méthode Koopman-Lit (2017)

Modèle à espace d'états pour les scores de football :

- Modélisation dynamique des forces d'attaque/défense comme un processus stochastique.
- Filtre de Kalman pour la mise à jour en temps réel.
- Capture les changements de régime (changement d'entraîneur, blessure clé).

**Comparaison** : VirtuMatch n'a pas de mise à jour dynamique des paramètres. Les coefficients sont statiques.

### 6.4 Standards de l'industrie

| Standard | VirtuMatch le respect ? |
|---|---|
| Évaluation out-of-sample obligatoire | ❌ Non |
| Séparation train/validation/test temporelle | ❌ Non |
| Interdiction de fuite future vérifiée automatiquement | ❌ Non |
| Métriques de calibration calculées (ECE, Brier) | ❌ Non |
| Comparaison avec baselines publiées | ❌ Non |
| Intervalles de confiance sur les métriques | ❌ Non |
| Tests de significativité (Diebold-Mariano) | ❌ Non |
| Reproductibilité (versionnage du modèle) | ❌ Non |

---

## 7. Déficits identifiés — Synthèse

| Déficit | Gravité | Détail | Impact |
|---|---|---|---|
| Pas de split temporel | CRITIQUE | Impossible de mesurer la performance réelle du modèle | Toute métrique est biaisée |
| Pas d'évaluation out-of-sample | CRITIQUE | Data snooping bias garanti | Métriques optimistes |
| Script de backtest rudimentaire | ÉLEVÉ | Pas un framework de backtest valide | Faux sentiment de validation |
| Pas de validation walk-forward | CRITIQUE | Coefficients non testés sur données futures simulées | Surapprentissage non détecté |
| Volume de données potentiellement insuffisant | MOYEN | < 10 000 matchs OOS | Intervalles de confiance larges |
| Pas de comparaison avec standards publiés | ÉLEVÉ | Pas de référence Dixon-Coles, Rue-Salvesen | Positionnement scientifique inconnu |
| Pas de reproductibilité | ÉLEVÉ | Pas de model_version sur les prédictions | Résultats non vérifiables |

---

## 8. Recommandation détaillée

### 8.1 Implémentation du framework walk-forward

1. **Créer** un module `walk-forward-backtest.ts` avec :
   - Génération automatique des fenêtres temporelles.
   - Vérification automatique de l'absence de fuite future.
   - Calcul des métriques par fenêtre et agrégées.
2. **Séparer** les données en fenêtres temporelles glissantes (train → validation → test).
3. **Pour chaque fenêtre** : entraîner sur train, optimiser sur validation, évaluer sur test.
4. **Ne jamais** utiliser les données de test pour l'optimisation des hyperparamètres.
5. **Rapporter** les métriques agrégées sur toutes les fenêtres de test (out-of-sample uniquement).
6. **Comparer** systématiquement avec les baselines (majorité, cotes implicites, Poisson simple, Dixon-Coles).
7. **Implémenter** le test de Diebold-Mariano pour la significativité statistique des différences entre modèles.

### 8.2 Vérification de la fuite future

Implémenter un audit automatique qui, pour chaque prédiction, vérifie :

- Aucune feature calculée à partir de données postérieures à `prediction_date`.
- Aucun coefficient optimisé à partir de données de la fenêtre TEST.
- Aucun résultat de match inclus dans les features avant la fin du match.

---

## 9. Conclusion

Le modèle VirtuMatch Predictor n'a fait l'objet d'**aucune validation backtest rigoureuse**. Le script existant est un embryon non fonctionnel. Sans backtest walk-forward :

- Les métriques de performance rapportées **n'ont aucune valeur prédictive démontrée**.
- Les coefficients du modèle (`prediction-config.ts`) sont **non validés empiriquement**.
- Il est **impossible** de distinguer surapprentissage de généralisation.
- Toute comparaison avec des baselines ou des modèles publiés est **infondée**.
- Le modèle ne respecte **aucun** des standards de backtesting de l'industrie ou de la littérature académique.

**L'état actuel est BACKTEST NON PROUVÉ.** L'implémentation d'un framework walk-forward est la priorité absolue (P1) du plan de remédiation.

---

*Ce rapport doit être mis à jour après l'implémentation du framework walk-forward (FIX-V3-05).*
