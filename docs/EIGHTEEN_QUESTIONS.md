# 18 QUESTIONS — Phase 4 Answers
Date: 2026-09-18T13:21:10.318Z
Model: VirtuMatch Predictor v2.0.0

---

## Methodology

Each question is answered with:
- A direct answer (never evasive)
- Supporting evidence (code references, coefficient values, analysis results)
- A confidence level (high/medium/low) reflecting the strength of the evidence

> **CRITICAL**: Where data is insufficient, "NON DÉTERMINABLE" is stated honestly.
> UNKNOWN is never converted to SAFE.
> "framework implemented" is never converted to "model scientifically validated".

## Q1: Combien de prédictions historiques sont réellement exploitables ?

**Answer** [confidence: high]:

0 — Aucune prédiction historique n'est accessible sans connexion Neon

**Evidence**:

NEON_DATABASE_URL n'est pas configurée dans l'environnement local. Les prédictions existent uniquement dans la base Neon PostgreSQL, inaccessible depuis l'environnement d'analyse.

---

## Q2: Combien disposent d'un snapshot complet ?

**Answer** [confidence: high]:

0 (sans accès Neon). Même avec accès Neon: vraisemblablement 0 ou très peu, car la migration 006 vient d'être créée en Phase 3 et les snapshots ne sont peuplés que pour les nouvelles prédictions.

**Evidence**:

La migration 006_feature_snapshot.sql ajoute les colonnes feature_snapshot, model_version, etc. comme NULLABLE. Les prédictions existantes auront feature_snapshot = NULL et provenance_status = 'UNKNOWN'. Seules les prédictions créées APRÈS la migration et APRÈS l'activation du snapshot auront des données.

---

## Q3: Combien sont seulement exploitables en Odds-only ?

**Answer** [confidence: high]:

Toutes les prédictions vérifiées avec odds sont exploitables en Odds-only. Les odds sont RECORDED dans la table predictions (odd_home, odd_draw, odd_away). C'est la seule source historique sûre.

**Evidence**:

La table predictions contient odd_home, odd_draw, odd_away (DECIMAL(6,2)), prob_home, prob_draw, prob_away (DECIMAL(5,2)), et actual_outcome. Ces colonnes existent depuis la création de la table et sont toujours peuplées.

---

## Q4: Le modèle VirtuMatch bat-il les baselines sur TEST ?

**Answer** [confidence: low]:

NON DÉTERMINABLE sans données réelles. Le modèle diverge en moyenne de 0.0% des odds normalisées (analyse sur 8 combinaisons d'odds). Cette divergence peut être bénéfique ou nuisible — seul un backtest empirique peut trancher.

**Evidence**:

Analyse du moteur sur 8 combinaisons d'odds: divergence moyenne = 0.0003, max = 0.0004. Le modèle modifie les probabilités odds-implied via Poisson grid search, redistribution virtuelle, et (quand disponible) form/H2H/AI. Sans données historiques, impossible de déterminer si ces modifications améliorent ou dégradent la précision.

---

## Q5: Le modèle est-il correctement calibré ?

**Answer** [confidence: medium]:

PROBABLEMENT PAS. La confidence est une heuristique additive (25-82%), PAS une probabilité calibrée. Les probabilités prob_home/prob_draw/prob_away sont des sorties du Poisson blend, pas des probabilités calibrées au sens statistique.

**Evidence**:

calculateMultiFactorConfidence() construit la confiance comme: base (max 68%) + formAgreement bonus + h2hAgreement bonus + aiAgreement bonus - odds gap penalties - anti-trap penalties, clampé à [25, 82]. C'est un score heuristique, pas une probabilité. Aucune calibration (Platt/isotonic) n'a été entraînée. ECE et MCE ne peuvent être calculés sans données empiriques.

---

## Q6: Quelle est l'incertitude des métriques ?

**Answer** [confidence: high]:

INCONNU sans données empiriques. Les intervalles de confiance bootstrap nécessitent N ≥ 30 prédictions vérifiées. Avec N = 0, aucune métrique n'a d'intervalle de confiance.

**Evidence**:

Le framework de bootstrap est implémenté (2000 resamples, 95% CI). Il produira des intervalles dès que des données seront disponibles. La largeur des intervalles dépendra de N: pour N=100, CI typiquement ±5-10%; pour N=30, ±10-15%.

---

## Q7: L'AI améliore-t-elle réellement les performances ?

**Answer** [confidence: medium]:

NON DÉTERMINABLE empiriquement. Théoriquement: AI_WEIGHT=0.35 est ARBITRAIRE (aucune base empirique). L'AI (Groq LLM) peut déjà intégrer les mêmes informations que les odds, créant un potentiel double comptage.

**Evidence**:

AI_WEIGHT=0.35 (calibrationStatus: 'arbitrary'). Le blendWithAI() mélange la matrice Poisson avec les probabilités AI: si AI_WEIGHT=0.35, alors 35% du résultat vient de l'AI. Si l'IA est corrélée avec les odds (ce qui est probable car l'IA reçoit les odds en contexte), cette contribution peut être redondante. L'ablation WITHOUT_AI nécessite des données empiriques.

---

## Q8: H2H améliore-t-il réellement les performances ?

**Answer** [confidence: medium]:

NON DÉTERMINABLE empiriquement. H2H utilise H2H_HOME_BOOST=0.5 et H2H_AWAY_PENALTY=0.3, tous deux ARBITRAIRE. L'impact est limité aux matchs avec historique entre les deux équipes.

**Evidence**:

H2H_HOME_BOOST=0.5 (calibrationStatus: 'arbitrary'), H2H_AWAY_PENALTY=0.3 (calibrationStatus: 'arbitrary'). L'ajustement lambda via H2H est: homeTeamBias / H2H_BIAS_DIVISOR (200), donc ±0.15 lambda max. En football virtuel, les confrontations directes sont rares → H2H a souvent 0 matchs → aucun impact. Même quand des données H2H existent, l'ajustement est faible (±0.15 sur un lambda typique de 0.5-2.5).

---

## Q9: Form améliore-t-elle réellement les performances ?

**Answer** [confidence: medium]:

NON DÉTERMINABLE empiriquement. FORM_ATTACK_BOOST=0.15 et FORM_DEFENSE_PENALTY=0.10 sont ARBITRAIRE. De plus, form et momentum partagent les mêmes données sous-jacentes (double comptage).

**Evidence**:

FORM_ATTACK_BOOST=0.15 (calibrationStatus: 'arbitrary'), FORM_DEFENSE_PENALTY=0.10 (calibrationStatus: 'arbitrary'). L'ajustement form: lambda += (avgScored - VIRTUAL_AVG_GOALS) * FORM_ATTACK_BOOST. Pour VIRTUAL_AVG_GOALS=1.3, une équipe marquant 2.0 buts/match reçoit +0.105 lambda. Mais momentum (dérivé des mêmes résultats) ajoute un SECOND ajustement via MOMENTUM_SCALE=500. Les mêmes matchs récents sont comptés deux fois.

---

## Q10: Momentum apporte-t-il une information indépendante ?

**Answer** [confidence: high]:

NON. Momentum est une fonction déterministe de form. Momentum = (weightedPoints / maxPoints) × 100, où weightedPoints sont les mêmes résultats de form avec les mêmes FORM_WEIGHTS. Momentum n'ajoute AUCUNE information qui n'est pas déjà dans form.

**Evidence**:

Dans prediction-engine.ts: extractTeamForm() calcule formScores ET momentumScore à partir des mêmes 5 derniers matchs. Les FORM_WEIGHTS [1.5, 1.3, 1.2, 1.1, 1.0] sont utilisées pour les deux. Momentum ajuste lambda via (momentumScore - 50) / MOMENTUM_SCALE, et form ajuste via (avgScored - VIRTUAL_AVG_GOALS) * FORM_ATTACK_BOOST. C'est un double comptage avéré.

---

## Q11: Anti-trap apporte-t-il une information indépendante ?

**Answer** [confidence: medium]:

PARTIELLEMENT. L'anti-trap détecte une configuration spécifique (forte différence de ranking + odds trop serrées) qui n'est PAS capturée par les autres features. Cependant, l'anti-trap dépend du ranking (UNKNOWN sans snapshot) et des odds (RECORDED).

**Evidence**:

Anti-trap se déclenche quand: (1) rankDiff >= ANTI_TRAP_RANK_DIFF (5 positions), ET (2) delta < ANTI_TRAP_DELTA_THRESHOLD (0.10). Cette combinaison est unique. L'impact est sur la confidence (pénalité -5 à -15), pas sur les probabilités directement. L'information est indépendante des odds seuls, MAIS dépend du ranking qui est UNKNOWN pour les anciennes prédictions.

---

## Q12: Stats apporte-t-il une information indépendante ?

**Answer** [confidence: medium]:

THÉORIQUEMENT OUI, mais avec un risque de double comptage avec les odds. Les stats d'équipe (avgGoalsScored, avgGoalsConceded, position) contiennent des informations que les odds ne capturent pas toujours. Cependant, STAT_BASE_WEIGHT=0.70 signifie que 70% de l'ajustement vient des odds, et les 30% restants (attack + defense) peuvent partiellement chevaucher les odds.

**Evidence**:

adjustLambdasWithStats() calcule: lambda_new = STAT_BASE_WEIGHT * lambda_odds + STAT_ATTACK_WEIGHT * attackAdj + STAT_DEF_WEIGHT * defenseAdj. Avec STAT_BASE_WEIGHT=0.70, les odds dominent. attackStrength = avgGoalsScored / VIRTUAL_AVG_GOALS. Si les odds reflètent déjà la force d'attaque (ce qui est typique), alors attackStrength est redondant avec la composante odds de lambda. Le degré de redondance dépend de l'efficacité du marché des odds.

---

## Q13: Existe-t-il des signes de double comptage ?

**Answer** [confidence: high]:

OUI — 6 chemins identifiés, dont 2 HIGH severity: (1) form→momentum (même donnée, deux ajustements), (2) AI→odds (l'IA peut intégrer les odds qui sont déjà dans le modèle).

**Evidence**:

Voir DOUBLE_COUNTING_AUDIT.md pour l'analyse détaillée. Les chemins critiques sont: form→momentum (HIGH): momentumScore est calculé à partir des mêmes matchs que formScores, puis utilisé pour un second ajustement lambda. AI→odds (HIGH): l'IA reçoit les odds en contexte, puis son output est blended à 35%, potentiellement sur-pondérant l'information odds. odds→stats (MEDIUM): STAT_BASE_WEIGHT=0.70 utilise les odds comme base, mais les odds ont déjà déterminé les lambdas via grid search.

---

## Q14: Existe-t-il une fuite de données ?

**Answer** [confidence: medium]:

AUCUNE DÉTECTÉE dans le code actuel. Les fonctions de reconstruction temporelle (getFormAtTimestamp, getH2HAtTimestamp, getStatsAtTimestamp) filtrent strictement les données avant predictionTimestamp. Cependant, SANS snapshot, la fuite ne peut être EXCLUE pour les anciennes prédictions (provenance UNKNOWN ≠ SAFE).

**Evidence**:

Leakage gate: timestamps_consistent=true, no_future_features=true (aucune violation temporelle dans le code). Les fonctions temporelles utilisent rTs < predictionTimestamp (strictement inférieur). Le risque principal est l'utilisation de getCurrentForm() au lieu de getFormAtTimestamp() dans les anciennes prédictions — sans snapshot, nous ne pouvons pas vérifier quelle fonction a été utilisée.

---

## Q15: Les anciennes prédictions peuvent-elles être utilisées pour valider le full model ?

**Answer** [confidence: high]:

NON. Les anciennes prédictions n'ont pas de feature_snapshot. Toutes les features au-delà des odds sont UNKNOWN. On ne peut PAS prouver l'absence de fuite de données. Règle: UNKNOWN n'est jamais SAFE par défaut.

**Evidence**:

Migration 006: UPDATE predictions SET provenance_status = 'UNKNOWN' WHERE feature_snapshot IS NULL. Pour les anciennes prédictions: Form=UNKNOWN, H2H=UNKNOWN, Stats=UNKNOWN, AI=UNKNOWN, Anti-trap=UNKNOWN, Momentum=UNKNOWN. Seuls les odds sont RECORDED. Le full model ne peut être validé qu'avec des prédictions ayant un snapshot valide.

---

## Q16: Les nouvelles prédictions peuvent-elles être validées scientifiquement grâce aux snapshots ?

**Answer** [confidence: high]:

OUI, en principe. Si feature_snapshot est peuplé avec toutes les features, leur timestamp, leur source, et leur valeur, alors chaque prédiction est reproductible et auditable. Il faut suffisamment de nouvelles prédictions (≥ 100) pour une validation statistique significative.

**Evidence**:

feature-snapshot.ts crée un snapshot versionné avec: schema_version, prediction_timestamp, features (odds, form, h2h, stats, ai, anti_trap avec valeurs + provenance + timestamps), coefficients (copie complète), config_hash. computeSnapshotHash() garantit la reproductibilité. Il suffit d'accumuler assez de prédictions avec snapshots pour lancer le backtest B.

---

## Q17: Quelle partie du système est réellement validée aujourd'hui ?

**Answer** [confidence: high]:

Seul le framework de validation est validé (code, tests, structure). AUCUNE partie du modèle de prédiction n'est empiriquement validée. Les coefficients sont heuristic/arbitrary. Le pipeline Poisson n'a pas été testé contre des résultats réels.

**Evidence**:

Les 40 coefficients: 15 arbitrary, 25 heuristic, 0 empirically_calibrated. Le pipeline 13 étapes n'a été testé que sur des données synthétiques. Les tests (938 API + 48 frontend) valident la logique et la sécurité, pas la performance prédictive. La conservation STAT_BASE + STAT_ATTACK + STAT_DEF = 1.0 est vérifiée, mais les valeurs individuelles ne sont pas calibrées.

---

## Q18: Quelle partie reste non validée ?

**Answer** [confidence: high]:

TOUT le modèle prédictif: (1) les 40 coefficients (15 arbitrary, 25 heuristic), (2) le pipeline Poisson 13 étapes, (3) AI_WEIGHT=0.35, (4) VIRTUAL_AVG_GOALS=1.3, (5) la calibration, (6) l'absence de fuite de données pour les anciennes prédictions, (7) l'indépendance des features, (8) l'utilité de chaque composant vs odds-only.

**Evidence**:

Arbitrary coefficients: VIRTUAL_AVG_GOALS, FORM_ATTACK_BOOST, FORM_DEFENSE_PENALTY, H2H_HOME_BOOST, H2H_AWAY_PENALTY, AI_WEIGHT, DEFAULT_AVG_SCORED, DEFAULT_AVG_CONCEDED, DEF_PENALTY_SELF, DEF_PENALTY_CROSS, H2H_BIAS_DIVISOR, FORM_AGREEMENT_THRESHOLD, H2H_AGREEMENT_THRESHOLD, HALF_TIME_FACTOR, NEW_SEASON_BOOST, ODDS_GAP_MODERATE. Aucun n'a été calibré sur des données empiriques.

---

## SUMMARY

| # | Confidence | Key Finding |
|---|------------|------------|
| 1 | high | Q1-Q3: 0 prédictions exploitables sans Neon |
| 2 | high | Q4: Performance vs baselines NON DÉTERMINABLE |
| 3 | high | Q5: Modèle probablement MAL calibré (heuristic confidence) |
| 4 | low | Q6: Incertitude INCONNUE (N=0) |
| 5 | medium | Q7: AI improvement NON DÉTERMINABLE (AI_WEIGHT arbitrary) |
| 6 | high | Q8: H2H improvement NON DÉTERMINABLE (coefficients arbitrary) |
| 7 | medium | Q9: Form improvement NON DÉTERMINABLE (double comptage form→momentum) |
| 8 | medium | Q10: Momentum PAS indépendant (dérivé de form) |
| 9 | medium | Q11: Anti-trap PARTIELLEMENT indépendant |
| 10 | high | Q12: Stats PARTIELLEMENT indépendant (risque double comptage avec odds) |
| 11 | medium | Q13: Double comptage CONFIRMÉ (6 chemins, 2 HIGH) |
| 12 | medium | Q14: Pas de fuite détectée dans le code, mais UNKNOWN sans snapshot |
| 13 | high | Q15: Anciennes prédictions NON utilisables pour full model |
| 14 | medium | Q16: Nouvelles prédictions THÉORIQUEMENT validables via snapshots |
| 15 | high | Q17: SEUL le framework est validé, pas le modèle |
| 16 | high | Q18: TOUT le modèle prédictif reste non validé |
