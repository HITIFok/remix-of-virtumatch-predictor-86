# AUDIT COMPLET V3 — RÉSUMÉ EXÉCUTIF
## VirtuMatch Predictor

**Date :** 2026-09-18  
**Branche :** `main` (commit `00525d9`)  
**Auditeur :** Indépendant (Phase 0 — lecture seule, aucune modification)

---

## CURRENT SECURITY STATUS

**Verdict : DÉPLOYABLE AVEC RÉSERVES**

Le système implémente une architecture de sécurité en profondeur solide : HMAC-SHA256 avec comparaison timing-safe, révocation de tokens Redis, limitation de débit Upstash, validation d'entrée par liste blanche, PII redaction dans les logs et Sentry, SQL paramétré via postgres.js, et OWASP Top 10 10/10 MITIGATED.

**Cependant :**

| # | Risque | Sévérité | Statut |
|---|--------|----------|--------|
| 1 | **`HMAC_ONLY` inconnu en production** — le fallback `x-device-id` permet l'usurpation d'identité | CRITIQUE | UNKNOWN |
| 2 | **HMAC signe uniquement `deviceId:timestamp`** — vulnérable au replay cross-endpoint et à la substitution de requête | HIGH | NOT PROVEN |
| 3 | **Pas de nonce** dans le protocole HMAC | HIGH | NOT PROVEN |
| 4 | **`generateDeletionSQL()`** utilise interpolation de chaînes — injection SQL potentielle | MEDIUM | NOT PROVEN (code non exécuté) |
| 5 | **État en mémoire perdu** lors des cold starts serverless (revocation, rate limiting) | MEDIUM | PROVEN |

Score interne du projet : **96/100 (A+)** — cet audit indépendant confirme un score effectif de **~85/100** tant que `HMAC_ONLY` n'est pas vérifié.

---

## CURRENT MODEL STATUS

**Verdict : NON VALIDÉ SCIENTIFIQUEMENT**

Le moteur de prédiction est un pipeline Poisson à 13 étapes avec 40 coefficients. Aucun coefficient n'est empiriquement validé. Aucun backtest walk-forward n'existe. Aucune calibration n'a été calculée. Les valeurs de "confiance" (25-82%) sont des heuristiques non calibrées, pas des probabilités de succès.

| # | Constat | Preuve |
|---|---------|--------|
| 1 | **0/40 coefficients empiriques** — 15 sont ARBITRAIRE, 25 sont HEURISTIC | PROVEN |
| 2 | **`VIRTUAL_AVG_GOALS = 1.3`** — la valeur la plus impactante, sans base empirique | PROVEN |
| 3 | **Double comptage** — les cotes influencent : favoriteProb, lambda, score, confiance | PROVEN |
| 4 | **Momentum = f(Form)** — pas un signal indépendant | PROVEN |
| 5 | **AI_WEIGHT = 0.35** — arbitraire, jamais testé hors échantillon | PROVEN |
| 6 | **Anti-trap** — hypothèse non validée (aucune précision/recall/lift calculée) | PROVEN |
| 7 | **Coefficients serveur ≠ client** — drift potentiel | PROVEN |
| 8 | **Aucune métrique de calibration** (ECE, Brier, Log Loss jamais calculés) | PROVEN |

---

## TOP 10 RISKS

| # | Risque | Domaine | Sévérité |
|---|--------|---------|----------|
| 1 | HMAC_ONLY inconnu en production | Sécurité | CRITIQUE |
| 2 | HMAC protocole incomplet (pas de nonce, method, path, body) | Sécurité | HIGH |
| 3 | Aucun backtest walk-forward | ML | HIGH |
| 4 | 15 coefficients arbitraires (0 empiriques) | ML | HIGH |
| 5 | Confiance non calibrée (heuristic, pas probabilité) | ML | HIGH |
| 6 | Double comptage odds → lambda → score → confidence | ML | MEDIUM |
| 7 | Cold start serverless perd revocation/rate-limit | Sécurité | MEDIUM |
| 8 | Server/client coefficient drift | ML | MEDIUM |
| 9 | GDPR 4/7 droits non implémentés | Conformité | MEDIUM |
| 10 | TypeScript strict OFF, 1 seul test frontend | Qualité | MEDIUM |

---

## TOP 10 SCIENTIFIC FINDINGS

| # | Finding | Statut |
|---|---------|--------|
| 1 | Aucune preuve que le modèle bat les probabilités implicites des cotes | UNKNOWN |
| 2 | Aucune preuve que le modèle bat un Poisson simple | UNKNOWN |
| 3 | Aucune preuve que l'IA améliore les résultats hors échantillon | UNKNOWN |
| 4 | Aucune preuve que H2H améliore les résultats | UNKNOWN |
| 5 | Momentum est redondant avec Form (dérivé) | PROVEN |
| 6 | Anti-trap : aucune métrique de performance calculée | PROVEN |
| 7 | ECE/Brier/Log Loss jamais calculés sur données réelles | PROVEN |
| 8 | 40 paramètres, potentiellement ~5700 matchs → risque d'overfitting | NOT PROVEN |
| 9 | Grid search utilise erreur L2, pas KL divergence | PROVEN |
| 10 | Redistribution virtuelle ad-hoc, pas dérivée d'un modèle de domaine | PROVEN |

---

## DATA LEAKAGE STATUS

**Aucune fuite de données prouvée.**

12/24 points d'audit ont une preuve formelle de non-leakage. 0 points ont une fuite prouvée. 10 points sont NOT PROVEN (risques théoriques : inclusion intra-round, ranking obsolète, stale cache). 1 point UNKNOWN (contamination du modèle Groq — indécidable).

**Réponse : "Existe-t-il une preuve de non-leakage ?" → OUI, partiellement (12/24 formellement prouvés).**

---

## CALIBRATION STATUS

**NON CALIBRÉ.** 

Les valeurs de confiance (25-82%) sont des heuristiques additives sans aucune calibration statistique. "confiance = 70%" ne signifie PAS "70% de probabilité de succès" — c'est un scoreheuristique non calibré.

ECE : jamais calculé. Brier : jamais calculé. Log Loss : jamais calculé. Reliability diagram : jamais produit.

---

## AI CONTRIBUTION

**UNKNOWN.** 

AI_WEIGHT = 0.35 est arbitraire. Aucune étude d'ablation n'existe. Aucune comparaison avec/sans IA hors échantillon n'a été effectuée. L'IA pourrait améliorer, dégrader, ou être neutre — aucune preuve dans aucune direction.

---

## BEST BASELINE COMPARISON

**AUCUNE BASELINE CALCULÉE.**

Les 10 baselines (Majority, Raw Odds, Normalized Odds, Simple Poisson, VirtuMatch complet, 5 ablations) n'ont jamais été calculées. La question "Le modèle bat-il les cotes implicites ?" reste UNKNOWN.

---

## COEFFICIENT STATUS

| Type | Nombre | Pourcentage | Validation |
|------|--------|-------------|------------|
| EMPIRICAL | 0 | 0% | Aucune |
| HEURISTIC | 25 | 62.5% | Raisonnement, pas données |
| ARBITRARY | 15 | 37.5% | Aucune base |

**Coefficient le plus critique :** `VIRTUAL_AVG_GOALS = 1.3` — impacte le grid search, l'ajustement stats, la forme, les valeurs par défaut. Entièrement arbitraire.

**Note :** Avoir des métadonnées (min, max, calibrationStatus) ≠ validation statistique. Seul le backtesting hors échantillon constitue une preuve.

---

## ARCHITECTURAL DEBT

| Dette | Impact | Priorité |
|-------|--------|----------|
| Serveur n'utilise pas le registre centralisé de coefficients | Drift silencieux | P1 |
| TypeScript strict mode OFF | Bugs potentiels | P2 |
| 1 seul test frontend (example) | Régression invisible | P2 |
| Prediction-engine.ts monolithique (1005 lignes) | Difficile à tester/ablater | P3 |
| Pas de versioning du modèle | Reproductibilité impossible | P3 |
| Supabase edge functions dupliquées (legacy/) | Maintenance | P4 |
| Pas de connection pooling (db.js) | Limite Neon | P4 |

---

## PERFORMANCE

- Build : 1.74s ✅
- 938 tests API : 7.57s ✅
- Grid search : ~314,000 appels Poisson par prédiction (acceptable pour prédiction unique, coûteux en batch)
- Bundle principal : 136.7 kB gzipped (44.4 kB) — acceptable
- Prediction engine : 68.9 kB gzipped (22.0 kB) — le plus gros module

---

## RECOMMENDED NEXT PHASE

### Phase 1 — Sécurité (0-7 jours)
1. **Vérifier et documenter** la valeur de `HMAC_ONLY` en production Vercel
2. Si `false` → planifier activation avec procédure de rollback
3. Étendre la signature HMAC (method:path:nonce:bodyHash)
4. Corriger `generateDeletionSQL()` → requêtes paramétrées

### Phase 2 — Validation du Modèle (1-8 semaines)
1. Extraire les prédictions vérifiées de la DB (join predictions + actual results)
2. Calculer ECE, Brier, Log Loss sur l'existant
3. Implémenter le backtest walk-forward
4. Construire les 10 baselines
5. Effectuer l'étude d'ablation
6. Calibrer le modèle (Platt/isotonic sur TRAIN/VALIDATION)

### Phase 3 — Optimisation (4-16 semaines)
1. Grid search des coefficients sur VALIDATION
2. Éliminer le double comptage dans la formule de confiance
3. Unifier les coefficients serveur/client
4. Refactoriser le moteur en modules

---

## GO / NO-GO

### 🟢 Sécurité Production : **GO AVEC RÉSERVE**

- OWASP 10/10, SQL paramétré, PII redaction, rate limiting Redis — fondations solides
- **Réserve :** `HMAC_ONLY` doit être vérifié et activé en production. Tant que le fallback `x-device-id` est actif, l'authentification peut être contournée.
- Score effectif : **85/100** (vs 96/100 interne) — la différence reflète l'incertitude HMAC_ONLY

### 🔴 Qualité Statistique : **NO-GO**

- 0 coefficient empirique, 0 backtest, 0 calibration, 0 ablation
- Le modèle n'a **aucune preuve** de valeur prédictive supérieure aux cotes implicites
- Les "confiances" ne sont pas des probabilités calibrées
- **Action requise :** extraire les données vérifiées, calculer les métriques, comparer aux baselines

### 🔴 Reproductibilité : **NO-GO**

- Pas de versioning du modèle (MODEL_VERSION, CONFIG_VERSION, etc.)
- Coefficients serveur/client divergent
- Prédictions persistées sans référence à la version du modèle
- **Action requise :** ajouter model_version à chaque prédiction, unifier les registres

---

*Audit réalisé sans modification du code (Phase 0). Tous les constats sont basés sur la lecture directe du code, l'exécution des tests, et l'analyse mathématique. Aucun rapport interne, score de sécurité, ou commentaire de code n'a été considéré comme preuve.*
