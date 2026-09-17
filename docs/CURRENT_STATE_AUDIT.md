# CURRENT STATE AUDIT — VirtuMatch V2

**Date**: 2026-09-17  
**Auditeur**: Principal Software Engineer + Security Engineer + ML/Statistics Engineer  
**Repository**: https://github.com/HITIFok/remix-of-virtumatch-predictor-86  
**Méthode**: Analyse statique du code actuel — aucun fichier modifié pendant l'audit

---

## EXECUTIVE SUMMARY

Le projet VirtuMatch est une application PWA de prédiction de football virtuel (React + Vite + Vercel Serverless + Neon PostgreSQL + Capacitor Android). L'audit révèle **6 findings CRITICAL**, **8 HIGH**, **12 MEDIUM**, **9 LOW**.

**Les 3 problèmes les plus urgents** :

1. **HMAC_ONLY=false en production** — le fallback `x-device-id` permet l'usurpation d'identité de n'importe quel appareil pour les opérations POST/PUT (insertion de prédictions, activation premium)
2. **Token revocation non fonctionnel en serverless** — la blacklist est in-memory, perdue à chaque cold start ; les tokens révoqués sont acceptés
3. **0 coefficient empiriquement validé** — les 22 coefficients du moteur de prédiction sont tous heuristiques ou arbitraires ; aucun n'a été calibré sur un TRAIN set et validé sur un TEST temporel indépendant

---

## RÉPONSES AUX 12 QUESTIONS EXPLICITES

### Q1: V-01 est-elle réellement corrigée ?

**Partiellement**. Le code implémente correctement le feature flag `HMAC_ONLY` et les restrictions du fallback (DELETE bloqué, body/query fallbacks supprimés). Cependant, **`HMAC_ONLY=false` en production**, donc le fallback reste actif et exploitable. V-01 sera réellement corrigée uniquement quand `HMAC_ONLY=true` sera activé.

**Statut**: ⚠️ CORRIGÉ EN CODE SEULEMENT — PAS EN PRODUCTION

---

### Q2: HMAC_ONLY est-il réellement obligatoire ?

**NON**. `process.env.HMAC_ONLY === 'true'` n'est pas défini dans l'environnement Vercel de production. Le fallback `x-device-id` est accepté pour toutes les méthodes sauf DELETE.

**Évidence** :
- `api/_lib/auth.js` ligne 211 : `const HMAC_ONLY = process.env.HMAC_ONLY === 'true';`
- Aucune variable `HMAC_ONLY` dans `.env`, `.env.example`, ou `vercel.json`
- Tests passent avec `HMAC_ONLY=true` mais la variable n'est pas activée en production

**Statut**: ❌ NON ACTIVÉ EN PRODUCTION

---

### Q3: V-02 est-elle réellement corrigée ?

**OUI**. Le bypass CORS via `x-capacitor-request` a été supprimé du code. La fonction `isOriginAllowed()` dans `api/_lib/cors.js` ne contient aucune référence à `x-capacitor-request`. L'origine Capacitor (`capacitor://localhost`, `https://localhost`) est dans la whitelist ALLOWED_ORIGINS et passe les checks normalement.

**Évidence** :
- `api/_lib/cors.js` ligne 26 : Commentaire explicite "V-02 FIX: x-capacitor-request bypass REMOVED"
- Aucun code qui lit `x-capacitor-request` dans le fichier

**Statut**: ✅ RÉELLEMENT CORRIGÉ

---

### Q4: V-03 est-elle réellement corrigée ?

**Partiellement**. Le CSP est défini dans `vercel.json` avec des directives strictes (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`). Cependant :

- `style-src 'self' 'unsafe-inline'` — nécessaire pour shadcn/ui + Tailwind, mais affaiblit la protection XSS via CSS
- `connect-src 'self' https://*.vercel.app` — le wildcard `*.vercel.app` est trop large ; autorise les connexions vers n'importe quel déploiement Vercel
- Aucun nonce ou hash pour les scripts inline (le PWA `loading-handler.js` pourrait être concerné)

**Statut**: ⚠️ PARTIELLEMENT CORRIGÉ — `unsafe-inline` CSS et `connect-src` trop large

---

### Q5: Le protocole HMAC est-il suffisamment robuste ?

**Non, 3 faiblesses majeures** :

| Faiblesse | Sévérité | Description |
|-----------|----------|-------------|
| **Pas de request binding** | HIGH | La signature HMAC couvre uniquement `deviceId:timestamp`. Un token valide pour un endpoint est valide pour TOUS les endpoints (replay cross-endpoint). Pas de nonce, pas de body hash, pas de method/path dans la signature. |
| **Pas de protection anti-replay** | HIGH | Deux requêtes identiques avec le même token sont acceptées. Le timestamp permet une fenêtre de 7 jours pour le replay. |
| **device_id non embarqué dans le token** | MEDIUM | Le `device_id` est transmis via `x-device-id` header séparément. Le token prouve uniquement qu'un secret connu a signé un timestamp, pas QUEL device il représente. Le lookup DB corrige cela, mais un attaquant qui obtient un secret peut forger des tokens pour ce device spécifique. |

**Recommandation** : Signature sur `method + path + timestamp + nonce + bodyHash` + cache anti-replay des nonces utilisés (Redis avec TTL).

**Statut**: ❌ INSUFFISAMMENT ROBUSTE

---

### Q6: Les 17/22 coefficients sont-ils réellement validés ?

**NON**. Sur 22 coefficients dans `prediction-config.ts` :

| Calibration | Count | Coefficients |
|-------------|-------|-------------|
| **arbitrary** ⚠️ | 9 | `VIRTUAL_AVG_GOALS`, `FORM_ATTACK_BOOST`, `FORM_DEFENSE_PENALTY`, `H2H_HOME_BOOST`, `H2H_AWAY_PENALTY`, `AI_WEIGHT`, `DEFAULT_AVG_SCORED`, `DEFAULT_AVG_CONCEDED`, `DEF_PENALTY_SELF`, `DEF_PENALTY_CROSS`, `H2H_BIAS_DIVISOR`, `FORM_AGREEMENT_THRESHOLD`, `H2H_AGREEMENT_THRESHOLD`, `HALF_TIME_FACTOR`, `NEW_SEASON_BOOST` |
| **heuristic** | 13 | Tous les autres |

**Aucun** coefficient n'a été :
- Estimé sur un dataset TRAIN
- Validé sur un TEST temporel indépendant (walk-forward)
- Calibré par Platt Scaling, Isotonic Regression, ou Beta Calibration

Les tests existants vérifient uniquement que les coefficients existent et sont dans les bornes déclarées — ce qui n'est PAS une validation statistique.

**Statut**: ❌ AUCUN COEFFICIENT EMPIRIQUEMENT VALIDÉ

---

### Q7: Existe-t-il un vrai backtest walk-forward ?

**NON**. Le fichier `scripts/backtest_prediction_engine.js` existe (330 lignes) mais :
- Utilise **8 matches synthétiques** (données fabriquées), pas des données historiques réelles
- Ne fait PAS de walk-forward (pas de split temporel TRAIN/TEST)
- Effectue une analyse de sensibilité (variation de coefficients) mais sans validation out-of-sample
- Ne vérifie PAS le data leakage (aucun test qu'une feature n'utilise pas de données postérieures au match)

**Statut**: ❌ PAS DE VRAI BACKTEST WALK-FORWARD

---

### Q8: Existe-t-il une calibration probabiliste ?

**NON**. La "confidence" produite par `calculateMultiFactorConfidence()` est un score composite [25%, 82%], PAS une probabilité calibrée. Aucune méthode de calibration (Platt, Isotonic, Beta) n'est implémentée. Le score de 82% ne signifie PAS "82% de probabilité que la prédiction soit correcte" sans calibration empirique.

**Statut**: ❌ PAS DE CALIBRATION PROBABILISTE

---

### Q9: L'IA améliore-t-elle objectivement le modèle ?

**INCONNU**. `AI_WEIGHT = 0.35` est arbitraire. Aucune comparaison quantitative n'a été faite entre :
- Model sans IA (AI_WEIGHT = 0)
- Model avec IA (AI_WEIGHT = 0.35)

Les métriques de comparaison (Brier Score, Log Loss, ECE) n'ont jamais été calculées. L'IA pourrait dégrader le modèle sans que personne le sache.

**Statut**: ❓ NON DÉTERMINÉ — AUCUNE COMPARAISON QUANTITATIVE

---

### Q10: Performance du modèle contre les probabilités implicites des cotes ?

**INCONNU**. Les cotes (odds) fournissent déjà une estimation de marché des probabilités 1X2. Le modèle Poisson est construit À PARTIR de ces cotes (grid search pour trouver λH, λA qui reproduisent les probabilités 1X2). En l'absence de backtest, on ne sait pas si les ajustements (form, H2H, AI, stats) améliorent ou dégradent la baseline "implied odds".

**Statut**: ❓ INCONNU — AUCUNE BASELINE COMPARÉE

---

### Q11: Existe-t-il du data leakage ?

**RISQUE ÉLEVÉ mais non vérifié**. Sources potentielles de data leakage :

1. **`extractTeamForm()`** — Utilise les 5 derniers matchs. Si les données historiques incluent des matchs pas encore joués (scrapées en avance), les features contiennent du futur.
2. **`extractH2H()`** — Même problème : les données H2H pourraient inclure des résultats pas encore disponibles au moment de la prédiction.
3. **Grid search** — Les λ sont dérivés des cotes actuelles, qui pourraient déjà intégrer le résultat (si les cotes sont post-match).
4. **Pas de timestamp de cutoff** — Aucune fonction ne prend un paramètre `asOfDate` pour filtrer les données historiques.

Aucun test anti-data-leakage n'existe.

**Statut**: ⚠️ RISQUE ÉLEVÉ — AUCUN TEST ANTI-LEAKAGE

---

### Q12: Les 10 problèmes techniques les plus importants restants ?

| # | ID | Sévérité | Problème |
|---|-----|----------|---------|
| 1 | AUTH-01 | CRITICAL | `HMAC_ONLY=false` — fallback exploitable pour POST/PUT |
| 2 | AUTH-02 | CRITICAL | `device-register` retourne le secret HMAC sans authentification |
| 3 | AUTH-03 | CRITICAL | Token revocation in-memory — inefficace en serverless |
| 4 | DB-01 | CRITICAL | `admin-codes.js` — fuite de connexion (`sql.end()` jamais appelé) |
| 5 | CRON-01 | CRITICAL | Vercel Crons échouent en 401 (pas de `x-cron-key` header) |
| 6 | CRON-02 | CRITICAL | Aucun lock concurrentiel pour `auto-playout` — double exécution possible |
| 7 | AUTH-04 | HIGH | `premium-activate` accepte le fallback device_id — activation premium par usurpation |
| 8 | HMAC-01 | HIGH | Signature HMAC non liée à la requête — replay cross-endpoint possible |
| 9 | PRED-01 | HIGH | 0 coefficient validé empiriquement — moteur non calibré |
| 10 | DB-02 | HIGH | Suppression GDPR non transactionnelle — état incohérent en cas d'échec partiel |

---

## ARCHITECTURE

### Cartographie

| Couche | Technologies | Fichiers clés |
|--------|-------------|---------------|
| **Frontend** | React 18 + Vite 8 + TypeScript + Tailwind 3 + shadcn/ui | `src/` (91 fichiers) |
| **Backend** | Vercel Serverless Functions (Node.js) | `api/` (12 endpoints) |
| **Database** | Neon PostgreSQL (serverless) | `api/_lib/db.js`, `sql/`, `api/_migrations/` |
| **Authentication** | HMAC device tokens + Bearer user sessions + Admin HMAC | `api/_lib/auth.js` |
| **Authorization** | Route-level `requireAuth()` / `requireUserAuth()` | Chaque route API |
| **Cron** | Vercel Crons + cron-job.org (externe) | `api/auto-playout.js`, `api/verify-predictions.js` |
| **Prediction** | Poisson Grid Search + AI (Groq) + Form + H2H + Trap | `src/lib/prediction-engine.ts` (1,351 lignes) |
| **AI** | Groq API (LLM) | `api/analyze-match.js` |
| **Android** | Capacitor 8 | `android/`, `capacitor.config.ts` |
| **Observability** | Sentry + structured logging | `api/_lib/sentry.js`, `api/_lib/logger.js` |
| **Testing** | Vitest 3 | `api/_lib/__tests__/` (40 fichiers), `src/test/` |
| **CI/CD** | GitHub Actions | `.github/workflows/` (3 workflows) |

---

## SECURITY FINDINGS

### CRITICAL (6)

| ID | Fichier | Ligne | Description | Impact | Exploitabilité | Recommandation |
|----|---------|-------|-------------|--------|----------------|----------------|
| AUTH-01 | `api/_lib/auth.js` | 211 | `HMAC_ONLY=false` — fallback `x-device-id` accepté pour POST/PUT | Usurpation d'identité : insertion de prédictions, activation premium comme n'importe quel device | HIGH — Envoyer `x-device-id: dev-xxxxxxxx` dans un header | **Activer `HMAC_ONLY=true` immédiatement** |
| AUTH-02 | `api/_lib/auth.js` | 61 | `registerDevice()` retourne le secret existant sans authentification | Un attaquant qui connaît un device_id obtient le secret HMAC et peut forger des tokens | MEDIUM — device_id devinable (djb2 fingerprint) | **Ne pas retourner le secret sur 409** — exiger un challenge-response |
| AUTH-03 | `api/_lib/token-revocation.js` | 14 | Blacklist in-memory — perdue à chaque serverless cold start | Tokens révoqués acceptés par les nouvelles instances | HIGH — Vercel cold starts fréquents | **Migrer vers Upstash Redis** (déjà disponible pour rate limiting) |
| DB-01 | `api/admin-codes.js` | 95, 404 | `sql.end()` jamais appelé — fuite de connexion PostgreSQL | Épuisement du pool de connexions → 500 sur toutes les routes DB | HIGH — chaque appel admin leak une connexion | **Ajouter `try/finally { await sql.end() }`** |
| CRON-01 | `vercel.json` | 12-24 | Vercel Crons n'envoient pas `x-cron-key` header | Les crons définis échouent en 401 à chaque exécution | CERTAIN — Vercel ne supporte pas les custom headers dans crons | **Utiliser `Authorization: Bearer CRON_SECRET` ou supprimer les crons Vercel** |
| CRON-02 | `api/auto-playout.js` | — | Aucun lock concurrentiel | Double exécution → résultats dupliqués, appels API gaspillés | MEDIUM — Vercel peut lancer des instances concurrentes | **Ajouter `pg_advisory_lock()` ou `locked_at` column** |

### HIGH (8)

| ID | Fichier | Description | Recommandation |
|----|---------|-------------|----------------|
| AUTH-04 | `api/premium-activate.js` | POST legacy accepte fallback device_id → activation premium par usurpation | Activer `HMAC_ONLY=true` |
| AUTH-05 | `api/_lib/ratelimit.js` | Tous les limiters utilisent `check()` (in-memory), jamais `checkDistributed()` | Migrer vers Redis pour les endpoints sensibles |
| HMAC-01 | `api/_lib/auth.js` | Signature HMAC non liée à la requête (pas de method/path/nonce/bodyHash) | Ajouter request binding + nonce anti-replay |
| DB-02 | `api/auth.js` | Suppression GDPR non transactionnelle (7 DELETE/UPDATE séquentiels) | Envelopper dans `sql.begin()` |
| DB-03 | `api/auto-playout.js` | `CREATE TABLE IF NOT EXISTS` à chaque invocation cron | Migrer vers schema migrations |
| DB-04 | — | Index manquants : `predictions(device_id)`, `predictions(status)`, `premium_activations(user_id)`, `access_codes(code)` | Ajouter les indexes |
| PRED-01 | `src/lib/prediction-config.ts` | 9 coefficients arbitraires, 13 heuristiques — 0 validé empiriquement | Backtest walk-forward + calibration |
| SEC-01 | `api/auto-playout.js` | Data-cleanup auth utilise `!==` au lieu de `timingSafeEqual` | Utiliser `crypto.timingSafeEqual` |

### MEDIUM (12)

| ID | Description |
|----|-------------|
| AUTH-06 | `analyze-match` n'a pas de rate limiting — abus de crédits Groq |
| AUTH-07 | Health endpoint (`verify-predictions?action=health`) sans auth — leak Node version, memory, DB status |
| AUTH-08 | `requireUserAuth()` silently skip revocation si import échoue |
| AUTH-09 | Session lifecycle registry montre 30j mais code utilise 7j — drift documentation |
| CSP-01 | `style-src 'unsafe-inline'` affaiblit protection XSS via CSS |
| CSP-02 | `connect-src 'self' https://*.vercel.app` trop large |
| CORS-01 | Default origins incluent `http://localhost` — doit être override en production |
| DB-05 | `push-odds.js` DELETE+INSERT non transactionnel — data loss si INSERT échoue |
| DB-06 | Pas de limite de taille sur `push-odds.js` payload |
| PRED-02 | ~30 magic numbers non configurables dans `prediction-engine.ts` |
| PRED-03 | Score matrix 7×7 vs `calculate1X2FromLambdas` 11×11 — inconsistency |
| PRED-04 | `evaluatePredictionQuality` biais home (+5) vs away (-5) vs draw (-20) |

### LOW (9)

| ID | Description |
|----|-------------|
| AUTH-10 | Pas de limite de sessions concurrentes par utilisateur |
| AUTH-11 | Rotation des secrets pas automatisée |
| AUTH-12 | Pas d'endpoint refresh token pour user sessions |
| DB-07 | `SELECT * FROM predictions` — fetch toutes les colonnes (~30) quand seules quelques-unes sont nécessaires |
| PRED-05 | Pas de Dixon-Coles implémenté (tau correlation pour low-scoring draws) |
| PRED-06 | `findTeamStats` substring matching — pourrait retourner la mauvaise équipe |
| PRED-07 | Factorial cache limité à 0-7 |
| OBS-01 | Sentry PII redaction pas vérifiée |
| OBS-02 | Pas de `model_version` / `feature_version` dans les prédictions stockées |

---

## AUTHENTICATION — Détail

### Token Types

| Type | Format | Secret | Expiry | Revocable | Refreshable |
|------|--------|--------|--------|-----------|-------------|
| Device HMAC | `base64url(ts).base64url(hmac)` | Per-device 32-byte random | 7 days | ❌ (rotate secret) | ✅ (client regenerates) |
| User Session | `base64url(ts).base64url(userId).base64url(hmac)` | `USER_SESSION_SECRET` | 7 days | ⚠️ In-memory only | ✅ (refresh-token endpoint) |
| Admin Session | `base64url(ts).base64url(hmac)` | `ADMIN_TOKEN_SECRET` | 24h | ❌ (rotate secret) | ❌ |
| Magic Link | Token hash in DB | Single-use | 15 min | ✅ (DB `used_at`) | ❌ |

### Auth Flow Priority

```
requireUserAuth() (Bearer) → requireAuth() (Device HMAC → fallback x-device-id)
```

Les endpoints premium vérifient d'abord le Bearer token (user auth), puis tombent sur device auth si le Bearer est absent/expiré. C'est correct, mais quand HMAC_ONLY=false, le fallback accepte n'importe quel `x-device-id`.

### Route-by-Route Auth Matrix

| Route | Method | Auth Required | HMAC_ONLY Impact |
|-------|--------|--------------|------------------|
| `/api/device-register` | POST | **NONE** | N/A — retourne secret sans auth |
| `/api/auth?action=request` | POST | NONE | N/A |
| `/api/auth?action=verify` | GET/POST | NONE (magic link) | N/A |
| `/api/auth?action=refresh-token` | POST | Bearer | N/A |
| `/api/auth?action=delete-account` | POST | Bearer | N/A |
| `/api/predictions` | GET | User OR Device | ⚠️ Fallback accepted |
| `/api/predictions` | POST | User OR Device | ⚠️ Fallback accepted |
| `/api/predictions` | DELETE | User OR Device | ✅ Fallback BLOCKED |
| `/api/verify-predictions` | GET/POST | Cron OR User OR Device | ⚠️ Fallback accepted |
| `/api/verify-predictions?action=health` | GET | **NONE** | ⚠️ Leaks system info |
| `/api/analyze-match` | POST | User OR Device | ⚠️ Fallback accepted, NO rate limit |
| `/api/premium-activate` | GET | User OR Device | ⚠️ Fallback accepted |
| `/api/premium-activate` | POST (legacy) | Device | ⚠️ Fallback accepted |
| `/api/premium-activate` | POST (email) | NONE | N/A |
| `/api/admin-codes?action=login` | POST | NONE | N/A |
| `/api/admin-codes` (other) | GET/POST | Admin Bearer | N/A |
| `/api/matches` | GET | NONE | N/A |
| `/api/fetch-live` | GET/POST | NONE | N/A |
| `/api/early-alerts` | GET | NONE (basic), Admin (?all=true) | N/A |
| `/api/auto-playout` | POST | Cron key | N/A |
| `/api/push-odds` | POST | Scraper key | N/A |

---

## CORS / CAPACITOR

### V-02 Status: ✅ CORRIGÉ

Le bypass `x-capacitor-request` a été supprimé. Les origines Capacitor (`capacitor://localhost`, `https://localhost`) sont dans la whitelist et passent les checks normalement. HMAC tokens authentifient les requêtes native indépendamment de CORS.

### CORS Risques Restants

| Risque | Sévérité | Description |
|--------|----------|-------------|
| Default origins dev-only | LOW | `DEFAULT_ORIGINS` inclut `http://localhost` variants — doit être override via `ALLOWED_ORIGINS` en prod |
| Pas de CORS pour les tokens Admin | INFO | Les endpoints admin vérifient le token HMAC, CORS est secondaire |

---

## CSP

### Directives Actuelles

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://lh3.googleusercontent.com;
font-src 'self';
connect-src 'self' https://*.vercel.app;
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

### Findings

| Directive | Statut | Recommandation |
|-----------|--------|----------------|
| `script-src 'self'` | ✅ Strict | — |
| `style-src 'self' 'unsafe-inline'` | ⚠️ Affaibli | Nécessaire pour Tailwind + shadcn/ui. Migration vers CSS external ou nonce possible mais coûteuse. |
| `connect-src 'self' https://*.vercel.app` | ⚠️ Trop large | Restreindre à `https://virtual-match-hitifproject.vercel.app` + API domain |
| `img-src ... data: blob:` | ⚠️ `data:` permet XSS via SVG | Restreindre si possible |
| `frame-ancestors 'none'` | ✅ Équivalent X-Frame-Options DENY | — |
| `base-uri 'self'` | ✅ | — |
| `form-action 'self'` | ✅ | — |
| `object-src` | ❌ Manquant | Ajouter `object-src 'none'` |
| `manifest-src` | ❌ Manquant | Ajouter `manifest-src 'self'` pour PWA |

---

## CRON JOBS

### Vercel Crons (vercel.json)

| Job | Schedule | Statut | Problème |
|-----|----------|--------|----------|
| `auto-playout` | 06:00 UTC | ❌ ÉCHOUERA | Vercel n'envoie pas `x-cron-key` → 401 |
| `auto-playout` | 03:00 UTC | ❌ ÉCHOUERA | Même problème |
| `verify-predictions` | 06:00 UTC | ❌ ÉCHOUERA | Même problème |

### External Cron (cron-job.org)

| Job | Schedule | Statut | Peut envoyer `x-cron-key` |
|-----|----------|--------|---------------------------|
| `auto-playout` | Every 1 min | ✅ Fonctionne | Oui (configuré manuellement) |

### Data Cleanup

| Job | Statut | Problème |
|-----|--------|----------|
| `data-cleanup` | ❌ JAMAIS DÉCLENCHÉ | Aucun cron Vercel n'envoie `x-cron-action: data-cleanup`. Les magic_links expirés et vieilles prédictions s'accumulent. |

### Concurrent Execution Risk

`auto-playout` n'a **aucun lock**. Si deux instances Vercel l'exécutent simultanément :
- `scheduled_fetches` peuvent être processées deux fois (ON CONFLICT DO NOTHING sur INSERT prévient les doublons de scheduling)
- `markFetchDone()` peut être appelé deux fois (idempotent mais gaspille des appels API)
- Pas de `pg_advisory_lock()` ni de `locked_at` column

---

## DATABASE

### Connection Management

✅ Per-request `createSql()` — serverless-safe  
✅ `sql.end()` appelé sur toutes les routes SAUF `admin-codes.js`  
❌ **`admin-codes.js` — fuite de connexion CRITICAL**  
⚠️ Pas de timeout sur les requêtes (default: none)  
⚠️ Pas de pool size configuration (default: 10)

### SQL Injection

✅ **Aucun risque** — toutes les requêtes utilisent les tagged template literals `postgres` qui paramètrent automatiquement les interpolations `${}`.

### Transactions

| Route | Transaction | Verdict |
|-------|-------------|---------|
| `auth.js` verify (premium activation) | ✅ `sql.begin()` + `FOR UPDATE` | Correct |
| `premium-activate.js` legacy | ✅ `sql.begin()` + `FOR UPDATE` | Correct |
| `admin-codes.js` migration | ✅ `sql.begin()` | Correct |
| `auth.js` GDPR deletion | ❌ **Pas de transaction** | CRITICAL — état incohérent |
| `push-odds.js` DELETE+INSERT | ❌ **Pas de transaction** | Data loss si INSERT échoue |

### Missing Indexes

| Table | Column(s) | Query Pattern | Index Needed |
|-------|-----------|---------------|-------------|
| `predictions` | `device_id` | WHERE device_id = ... (most common) | **YES** |
| `predictions` | `status` | WHERE status = 'pending' (cron) | **YES** |
| `premium_activations` | `user_id` | WHEREE user_id = ... | **YES** |
| `premium_activations` | `device_id` | WHERE device_id = ... (legacy) | **YES** |
| `access_codes` | `code` | WHERE code = ... (activation) | **YES** |
| `scraped_data` | `(data_type, league)` | WHERE data_type AND league | **YES** |

---

## RATE LIMITING

### Implementation

| Mode | Used By | Effective in Serverless |
|------|---------|----------------------|
| **Redis (Upstash)** | `middleware.js` (edge) | ✅ Distribué — survit les cold starts |
| **In-memory** | All API handlers (`api/_lib/ratelimit.js`) | ❌ Per-instance — reset on cold start |

### Finding

⚠️ **Tous les handlers API utilisent `check()` (sync/in-memory), jamais `checkDistributed()` (async/Redis).** Le middleware edge utilise Redis, mais les handlers individuels (auth, predictions, premium, admin) utilisent uniquement in-memory. En serverless, les limites sont bypassées par les cold starts.

### All Rate Limiters

| Name | Max | Window | Key | Effective Mode |
|------|-----|--------|-----|----------------|
| middleware (standard) | 30/min | 1 min | IP | Redis (if configured) |
| middleware (strict) | 10/min | 1 min | IP | Redis (if configured) |
| predictions | 30/min | 1 min | IP | In-memory ❌ |
| auth-email | 3/15min | 15 min | Email | In-memory ❌ |
| auth-ip | 3/15min | 15 min | IP | In-memory ❌ |
| refresh-token | 10/hour | 1 hour | IP | In-memory ❌ |
| account-delete | 3/hour | 1 hour | IP | In-memory ❌ |
| device-register | 5/min | 1 min | IP | In-memory ❌ |
| premium-activate | 15/hour | 1 hour | Email/device | In-memory ❌ |
| admin-login | 5/15min | 15 min | IP | In-memory ❌ |

---

## PREDICTION ENGINE

### Architecture

| Attribute | Value |
|-----------|-------|
| Lines | 1,351 |
| Pipeline steps | 13 |
| Config coefficients | 22 |
| Hardcoded magic numbers | ~30 |
| Anti-trap sources | 5 |
| Confidence range | [25%, 82%] |
| AI weight | 0.35 (35%) |
| Dixon-Coles | ❌ Not implemented |
| Bivariate Poisson | ❌ Not implemented |

### Pipeline

```
1. convertOddsToProbabilities() → pH, pD, pA, favorite
2. gridSearchLambdas() → base λH, λA
3. extractTeamForm() × 2 + extractH2H()
4. adjustLambdasWithStats() → λ adjusted (70/20/10 split)
5. adjustLambdasWithHistory() → λ adjusted (form + momentum + H2H)
6. generateScoreMatrix() → 7×7 Poisson matrix
7. blendWithAI() → AI score boosted (35% weight)
8. redistributeForVirtualFootball() → cap at 3 goals, redistribute
9. determineMainScore() → pick most probable + trap detection
10. detectSpecialSituations() → 5-source anti-trap
11. calculateHalfTimeScore() → HT prediction
12. calculateAdditionalMarkets() → GG, O/U 2.5, parity
13. calculateMultiFactorConfidence() → confidence [25%, 82%]
```

### Double Counting Analysis

| Feature Pair | Overlap Risk | Description |
|-------------|-------------|-------------|
| Grid Search λ ↔ Stat Attack/Defense | **HIGH** | Grid search encode déjà la relation λH/λA. Le cross-term `STAT_DEF_WEIGHT` (λA × defenseWeakness) double-counte cette information. |
| Odds probabilities ↔ Form direction | MEDIUM | Form est souvent alignée avec les mouvements de cotes. Les deux boostent le favori. |
| H2H bias ↔ AI agreement | MEDIUM | L'IA (Groq) a accès aux données H2H et peut reproduire le même signal. |
| Momentum ↔ Form weights | LOW | Momentum est dérivé des résultats récents, qui alimentent aussi form. Légère corrélation. |

### Data Leakage Risks

| Source | Risk | Description |
|--------|------|-------------|
| `extractTeamForm()` | **HIGH** | Utilise les 5 derniers matchs SANS vérifier qu'ils sont antérieurs à la prédiction |
| `extractH2H()` | **HIGH** | Même problème — données H2H pourraient inclure des résultats futurs |
| Grid search from odds | **MEDIUM** | Cots post-match intégreraient le résultat |
| No `asOfDate` parameter | **HIGH** | Aucune fonction ne prend de cutoff temporel |

---

## COEFFICIENT AUDIT

### Complete Registry (22 coefficients)

| # | Name | Value | Min | Max | Unit | Calibration |
|---|------|-------|-----|-----|------|-------------|
| 1 | `GRID_MIN_LAMBDA` | 0.5 | 0.2 | 1.0 | goals/match | heuristic |
| 2 | `GRID_MAX_LAMBDA` | 3.0 | 2.0 | 4.0 | goals/match | heuristic |
| 3 | `GRID_STEP` | 0.05 | 0.01 | 0.10 | goals/match | heuristic |
| 4 | `FORM_WEIGHT_0` | 1.5 | 1.0 | 2.0 | weight | heuristic |
| 5 | `FORM_WEIGHT_1` | 1.3 | 1.0 | 1.8 | weight | heuristic |
| 6 | `FORM_WEIGHT_2` | 1.2 | 0.8 | 1.5 | weight | heuristic |
| 7 | `FORM_WEIGHT_3` | 1.1 | 0.7 | 1.3 | weight | heuristic |
| 8 | `FORM_WEIGHT_4` | 1.0 | 0.5 | 1.2 | weight | heuristic |
| 9 | `VIRTUAL_AVG_GOALS` | **1.3** | 0.9 | 1.8 | goals/match | **⚠️ arbitrary** |
| 10 | `STAT_BASE_WEIGHT` | 0.70 | 0.50 | 0.85 | ratio | heuristic |
| 11 | `STAT_ATTACK_WEIGHT` | 0.20 | 0.10 | 0.35 | ratio | heuristic |
| 12 | `STAT_DEF_WEIGHT` | 0.10 | 0.05 | 0.20 | ratio | heuristic (cross-term) |
| 13 | `FORM_ATTACK_BOOST` | 0.15 | 0.05 | 0.30 | goals/diff | **⚠️ arbitrary** |
| 14 | `FORM_DEFENSE_PENALTY` | 0.10 | 0.05 | 0.20 | goals/diff | **⚠️ arbitrary** |
| 15 | `MOMENTUM_SCALE` | 500 | 200 | 1000 | divisor | heuristic |
| 16 | `H2H_HOME_BOOST` | 0.5 | 0.2 | 0.8 | ratio | **⚠️ arbitrary** |
| 17 | `H2H_AWAY_PENALTY` | 0.3 | 0.1 | 0.6 | ratio | **⚠️ arbitrary** |
| 18 | `AI_WEIGHT` | 0.35 | 0.10 | 0.50 | ratio | **⚠️ arbitrary** |
| 19 | `VIRTUAL_CAP` | 3 | 2 | 4 | goals | heuristic |
| 20 | `CONF_BASE_SCALE` | 85 | 70 | 100 | ratio | heuristic |
| 21 | `CONF_MAX_BASE` | 68 | 55 | 80 | % | heuristic |
| 22 | `CONF_CAP` | 82 | 70 | 90 | % | heuristic |

+ 15 Phase W coefficients (thresholds, defaults, redistribution params) — mostly arbitrary.

### Validation Status

- ✅ Conservation law: `STAT_BASE_WEIGHT + STAT_ATTACK_WEIGHT + STAT_DEF_WEIGHT = 1.0` (enforced)
- ✅ Monotonicity: `FORM_WEIGHT_0 > FORM_WEIGHT_1 > ... > FORM_WEIGHT_4` (enforced)
- ✅ Bounds: All values within [min, max] (enforced)
- ❌ Empirical: **0 coefficient validated on independent temporal test set**
- ❌ Calibration: **No Platt/Isotonic/Beta calibration applied**

---

## BACKTESTING

### Current State

| Aspect | Statut |
|--------|--------|
| Walk-forward framework | ❌ N'existe pas |
| Historical dataset | ❌ Pas de dataset de backtest |
| TRAIN/TEST split | ❌ Pas de split temporel |
| Anti-data-leakage tests | ❌ Aucun |
| Baseline comparison | ❌ Aucune |
| Calibration | ❌ Aucune |

### Required Baselines

| Model | Description | Statut |
|-------|-------------|--------|
| Baseline A | Majority class (Home win) | ❌ Pas implémenté |
| Baseline B | Implied odds probabilities | ❌ Pas implémenté |
| Baseline C | Poisson from odds (no adjustments) | ❌ Pas implémenté |
| Model D | Current model (all features) | ❌ Pas backtesté |
| Model E | Current sans H2H | ❌ Pas implémenté |
| Model F | Current sans form | ❌ Pas implémenté |
| Model G | Current sans momentum | ❌ Pas implémenté |
| Model H | Current sans trap | ❌ Pas implémenté |
| Model I | Current sans AI | ❌ Pas implémenté |
| Model J | Optimized statistical model | ❌ Pas implémenté |
| Model K | Optimized + AI | ❌ Pas implémenté |

### Required Metrics

| Metric | Description | Statut |
|--------|-------------|--------|
| Accuracy | % correct predictions | ❌ |
| Log Loss | Probabilistic quality | ❌ |
| Brier Score | Quadratic probabilistic score | ❌ |
| ECE | Expected Calibration Error | ❌ |
| Calibration curve | Reliability diagram | ❌ |
| Precision/Recall/F1 | Per class | ❌ |

---

## CALIBRATION

### Current State

La "confidence" [25%, 82%] est un **score composite**, pas une probabilité calibrée.

| Calibration Method | Statut |
|--------------------|--------|
| Platt Scaling | ❌ Pas implémenté |
| Isotonic Regression | ❌ Pas implémenté |
| Beta Calibration | ❌ Pas implémenté |
| Reliability Diagram | ❌ Pas implémenté |

**Règle absolue** : Une confidence de 82% ne peut PAS être appelée "82% de probabilité" sans calibration empirique sur un dataset indépendant.

---

## AI EVALUATION

### Current State

- `AI_WEIGHT = 0.35` — arbitraire
- AI blend : multiplie la prob du score AI par 1.35 dans la matrice Poisson
- AI agreement signal (±1) → ±4 points de confidence
- **Aucune comparaison quantitative** : Brier Score, Log Loss, ECE — jamais calculés
- **Aucun ablation study** : on ne sait pas si l'IA améliore ou dégrade

### Required Tests

| Test | Description | Statut |
|------|-------------|--------|
| AI_WEIGHT = 0 vs 0.35 | Comparaison Brier/LogLoss/ECE | ❌ |
| AI_WEIGHT grid [0, 0.05, 0.10, ..., 0.35] | Optimal sur TRAIN | ❌ |
| AI agreement → calibration | Est-ce que AI agree → meilleure calibration ? | ❌ |

---

## POISSON

### Current Implementation

- **Poisson univariate** — PMF: e^(-λ) × λ^k / k!
- **Grid search** — 51×51 = 2,601 iterations (λ ∈ [0.5, 3.0], step 0.05)
- **Score matrix** — 7×7 (goals 0-6)
- **Independence assumption** — home/away goals supposés indépendants

### Missing

| Model | Statut | Impact |
|-------|--------|--------|
| Dixon-Coles | ❌ | Pas de correction τ pour les scores faibles (0-0, 1-0, 0-1, 1-1) — sous-estime les draws serrés |
| Bivariate Poisson | ❌ | Pas de corrélation home/away — suppose l'indépendance |
| Overdispersion test | ❌ | Football virtuel pourrait avoir variance > λ (Poisson suppose variance = λ) |
| Zero-inflation test | ❌ | Plus de 0-0 que prévu par Poisson ? |

---

## OBSERVABILITY

### Current

| Tool | Statut | Issues |
|------|--------|--------|
| Sentry | ✅ Configured | PII redaction pas vérifiée |
| Structured logging | ✅ `createLogger()` | Logs en console Vercel |
| Error correlation IDs | ✅ `generateCorrelationId()` | — |
| Rate limit headers | ✅ `X-RateLimit-*` | — |

### Missing

| Attribute | Statut |
|-----------|--------|
| `request_id` per prediction | ❌ |
| `prediction_id` | ❌ |
| `model_version` | ❌ |
| `feature_version` | ❌ |
| `calibration_version` | ❌ |
| Latency tracking | ❌ |
| Groq API latency | ❌ |

### PII Risk

⚠️ Les logs contiennent potentiellement : IP addresses, device_ids, email addresses. La redaction Sentry n'a pas été auditée.

---

## TESTING

### Security Tests (40 files)

✅ Extensive security test suite couvrant : auth, rate limiting, CORS, CSP, backtest, calibration, session lifecycle, refresh token, HMAC migration, HMAC-only, auth matrix, token revocation, secret rotation, data classification, OWASP, GDPR, attack surface, security score, security headers, security regression, Sentry, Redis rate limiting, E2E framework, supply chain, dependency audit, health monitoring, documentation, CI pipeline, certification closeout, final report, implementation P1-P5.

**Caveat** : Un test qui vérifie qu'un coefficient existe n'est PAS une preuve qu'il est statistiquement correct. Un score de sécurité interne n'est PAS un audit indépendant.

### Prediction Engine Tests

| Test Type | Statut |
|-----------|--------|
| Config existence/bounds | ✅ (2 fichiers) |
| Pipeline unit tests (analyzeMatch) | ❌ |
| Poisson math verification | ❌ |
| Grid search convergence | ❌ |
| AI blend edge cases | ❌ |
| Confidence boundary tests | ❌ |
| Trap detection integration | ❌ |
| Virtual redistribution conservation | ❌ |
| Anti-data-leakage | ❌ |
| Walk-forward backtest | ❌ |

---

## TECHNICAL DEBT

| # | Description | Sévérité | Effort |
|---|-------------|----------|--------|
| 1 | `prediction-engine.ts` : 1,351 lignes, 17+ fonctions — doit être découpé | HIGH | Large |
| 2 | TypeScript `strict: false` — `noImplicitAny: false` | MEDIUM | Medium |
| 3 | Stale Supabase pg_cron jobs — appellent des Edge Functions inexistantes | MEDIUM | Small |
| 4 | Legacy `supabase/` directory — architecture pré-migration | LOW | Small |
| 5 | 30+ scripts Python/JS dans `scripts/` — many one-off | LOW | Small |
| 6 | `*.json` data files at root (bet261-*.json) | LOW | Small |
| 7 | No model versioning in stored predictions | MEDIUM | Medium |
| 8 | No refresh token for user sessions | LOW | Medium |

---

## PRIORITIES

### P0 — Immediate (sécurité critique)

1. **Activer `HMAC_ONLY=true` en production** — Élimine le plus grand vecteur d'attaque
2. **Corriger `admin-codes.js` connection leak** — `try/finally { await sql.end() }`
3. **Corriger Vercel Crons** — Utiliser `Authorization: Bearer CRON_SECRET` ou documenter que seul cron-job.org fonctionne

### P1 — This Week (sécurité haute)

4. **Migrer token revocation vers Redis** — Utiliser l'infrastructure Upstash existante
5. **Ne pas retourner device_secret sur 409** — Challenge-response ou refuser
6. **Ajouter `pg_advisory_lock()` aux crons** — Prévenir double exécution
7. **Transaction GDPR deletion** — Envelopper dans `sql.begin()`
8. **Ajouter indexes manquants** — `predictions(device_id)`, `predictions(status)`, etc.

### P2 — This Month (sécurité medium + stats)

9. **HMAC request binding** — Signature sur `method + path + timestamp + nonce + bodyHash`
10. **Redis rate limiting pour handlers** — Migrer vers `checkDistributed()`
11. **Rate limit `analyze-match`** — Protéger les crédits Groq
12. **Restreindre CSP `connect-src`** — Enlever le wildcard `*.vercel.app`
13. **Construire dataset de backtest** — Données historiques avec timestamps
14. **Walk-forward framework** — Split temporel TRAIN/TEST

### P3 — Next Quarter (statistical validation)

15. **Calibration empirique** — Platt/Isotonic sur TRAIN, validation sur TEST
16. **AI ablation study** — Comparer AI_WEIGHT = 0 vs 0.35
17. **Coefficient optimization** — Grid search ou Bayesian opt sur TRAIN
18. **Baseline comparison** — Implied odds vs Poisson vs current model
19. **Dixon-Coles implementation** — Correction τ pour low-scoring draws
20. **Anti-data-leakage tests** — Vérifier features n'utilisent pas le futur

### P4 — Future (refactoring + quality)

21. **Découper `prediction-engine.ts`** — Orchestrator + modules (odds, poisson, features, form, h2h, ai, calibration, trap)
22. **Model versioning** — MODEL_VERSION, FEATURE_VERSION, CALIBRATION_VERSION dans chaque prédiction
23. **TypeScript strict mode** — `strict: true`, `noImplicitAny: true`
24. **Supprimer legacy Supabase** — `supabase/` et `legacy/supabase-pre-migration/`
25. **Performance optimization** — SQL, Poisson cache, Groq latency

---

## FINDING FORMAT — Complete List

### AUTH-01 — CRITICAL
- **File**: `api/_lib/auth.js:211`
- **Description**: `HMAC_ONLY=false` en production — fallback `x-device-id` accepté pour POST/PUT
- **Impact**: Usurpation d'identité device pour insertion prédictions, activation premium
- **Evidence**: `const HMAC_ONLY = process.env.HMAC_ONLY === 'true';` — variable non définie en prod
- **Exploitability**: HIGH — Envoyer `x-device-id: dev-target` dans header
- **Recommendation**: `HMAC_ONLY=true` dans Vercel environment
- **Test**: `curl -X POST -H "x-device-id: dev-victim" /api/predictions` — should return 401
- **Status**: ❌ OPEN

### AUTH-02 — CRITICAL
- **File**: `api/_lib/auth.js:61`
- **Description**: `registerDevice()` retourne secret HMAC existant sans authentification
- **Impact**: Attaquant obtient secret → forge tokens indefinitely
- **Evidence**: `return { success: true, device_secret: existing.device_secret, alreadyRegistered: true };`
- **Exploitability**: MEDIUM — nécessite de connaître/deviner un device_id
- **Recommendation**: Ne pas retourner le secret sur 409. Implémenter challenge-response.
- **Test**: `curl -X POST -d '{"device_id":"dev-knownid"}' /api/device-register` — should NOT return secret
- **Status**: ❌ OPEN

### AUTH-03 — CRITICAL
- **File**: `api/_lib/token-revocation.js:14`
- **Description**: Blacklist in-memory — perdue à chaque serverless cold start
- **Impact**: Tokens révoqués acceptés par nouvelles instances
- **Evidence**: `const memoryBlacklist = new Map();` — pas de Redis
- **Exploitability**: HIGH — Vercel cold starts fréquents sous load
- **Recommendation**: Migrer vers Upstash Redis (même infra que rate limiting middleware)
- **Test**: Revoke token → trigger cold start → verify revoked token is accepted (bug)
- **Status**: ❌ OPEN

### DB-01 — CRITICAL
- **File**: `api/admin-codes.js:95,404`
- **Description**: `sql.end()` jamais appelé — fuite de connexion PostgreSQL
- **Impact**: Épuisement pool → 500 sur toutes les routes DB
- **Evidence**: Pas de `sql.end()` dans `handleLogin()`, `handleGet()`, `handlePost()`
- **Exploitability**: CERTAIN — chaque appel admin leak une connexion
- **Recommendation**: Ajouter `try/finally { await sql.end() }` dans chaque handler
- **Test**: Appeler `/api/admin-codes` 20 fois → vérifier connexions leakées
- **Status**: ❌ OPEN

### CRON-01 — CRITICAL
- **File**: `vercel.json:12-24`
- **Description**: Vercel Crons n'envoient pas `x-cron-key` header → 401
- **Impact**: Crons ne s'exécutent jamais ; prédictions jamais vérifiées
- **Evidence**: `auto-playout` et `verify-predictions` exigent `x-cron-key` matching `CRON_SECRET`
- **Exploitability**: CERTAIN — Vercel crons fail silencieusement
- **Recommendation**: Utiliser `Authorization: Bearer CRON_SECRET` ou supprimer Vercel crons (cron-job.org fonctionne)
- **Test**: Vérifier Vercel deployment logs pour 401 sur cron invocations
- **Status**: ❌ OPEN

### CRON-02 — CRITICAL
- **File**: `api/auto-playout.js`
- **Description**: Aucun lock concurrentiel — double exécution possible
- **Impact**: Résultats dupliqués, appels API gaspillés
- **Evidence**: Pas de `pg_advisory_lock()` ou `locked_at` column
- **Exploitability**: MEDIUM — Vercel peut lancer instances concurrentes
- **Recommendation**: `SELECT pg_advisory_lock(hashtext('auto-playout'))` en début de handler
- **Test**: Lancer 2 invocations concurrentes → vérifier traitement unique
- **Status**: ❌ OPEN

### PRED-01 — HIGH
- **File**: `src/lib/prediction-config.ts`
- **Description**: 0 coefficient empiriquement validé — 9 arbitrary, 13 heuristic
- **Impact**: Moteur non calibré — prédictions potentiellement worse que baseline
- **Evidence**: Aucun walk-forward backtest, aucune calibration
- **Exploitability**: N/A (not a security issue)
- **Recommendation**: Backtest walk-forward + calibration Platt/Isotonic
- **Test**: Comparer Brier Score model vs implied odds baseline
- **Status**: ❌ OPEN

---

*Fin du rapport CURRENT_STATE_AUDIT.md — Aucun fichier modifié pendant l'audit.*
