# SECURITY REMEDIATION PLAN — VirtuMatch V2

**Date**: 2026-09-17  
**Basé sur**: CURRENT_STATE_AUDIT.md  
**Objectif**: Corriger tous les findings CRITICAL et HIGH, planifier les MEDIUM

---

## P0 — IMMEDIATE (aujourd'hui)

### FIX-01: admin-codes.js — Connection Leak (DB-01)

**Finding**: `sql.end()` jamais appelé → fuite de connexion PostgreSQL  
**Fichier**: `api/admin-codes.js`  
**Action**: Ajouter `try/finally { await sql.end() }` dans `handleLogin()`, `handleGet()`, `handlePost()`

```js
// AVANT (handleLogin)
async function handleLogin(req, res, body) {
  ...
  const sql = createSql();
  try {
    const [result] = await sql`SELECT verify_admin_password(...)`;
    ...
  } catch (err) {
    return internalError(res, err);
  }
  // sql.end() JAMAIS APPELÉ
}

// APRÈS
async function handleLogin(req, res, body) {
  if (!NEON_DATABASE_URL) { ... }
  const sql = createSql();
  try {
    const [result] = await sql`SELECT verify_admin_password(...)`;
    ...
  } catch (err) {
    log.error('Login exception', undefined, { cause: err });
    return internalError(res, err);
  } finally {
    try { await sql.end(); } catch { /* ignore */ }
  }
}
```

Même pattern pour `handleGet()` et `handlePost()` — envelopper dans try/finally.

**Test**: Appeler `/api/admin-codes?action=login` 20× → vérifier pool stable.

---

### FIX-02: Vercel Crons — 401 Unauthorized (CRON-01)

**Finding**: Vercel Crons n'envoient pas `x-cron-key` header → endpoints exigent `CRON_SECRET` → 401  
**Fichiers**: `vercel.json`, `api/auto-playout.js`, `api/verify-predictions.js`  
**Action**: Accepter `Authorization: Bearer CRON_SECRET` en plus de `x-cron-key`

```js
// Dans auto-playout.js et verify-predictions.js
// AVANT
const providedKey = req.headers['x-cron-key'] || '';
if (!timingSafeEqual(providedKey, CRON_SECRET)) {
  return unauthorized(res, 'Cron key invalide');
}

// APRÈS
const cronKey = req.headers['x-cron-key'] || '';
const authHeader = req.headers['authorization'] || '';
const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
const providedSecret = cronKey || bearerToken;
if (!timingSafeEqual(providedSecret, CRON_SECRET)) {
  return unauthorized(res, 'Cron key invalide');
}
```

Vercel Crons envoient automatiquement l'en-tête `Authorization: Bearer <CRON_SECRET>` si configuré. Mettre à jour `vercel.json` :

```json
{
  "crons": [
    {
      "path": "/api/auto-playout",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/verify-predictions",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/auto-playout",
      "schedule": "0 3 * * *"
    }
  ]
}
```

Et configurer `CRON_SECRET` dans Vercel environment variables. Vercel injecte automatiquement `Authorization: Bearer <CRON_SECRET>` pour les crons natifs quand `CRON_SECRET` est défini comme env var.

---

### FIX-03: Data Cleanup Cron + timingSafeEqual (CRON-01/SEC-01)

**Finding**: Data-cleanup jamais déclenché ; auth utilise `!==` au lieu de `timingSafeEqual`  
**Fichier**: `api/auto-playout.js`  
**Action**:
1. Ajouter data-cleanup schedule dans `vercel.json`
2. Remplacer `!==` par `timingSafeEqual` pour cleanup auth

```json
{
  "path": "/api/auto-playout",
  "schedule": "0 2 * * 0"
}
```

(Ajout d'un cron le dimanche à 2h UTC avec `x-cron-action: data-cleanup`)

Pour le timing-safe :

```js
// AVANT
if (providedSecret !== CLEANUP_CRON_SECRET) { ... }

// APRÈS
if (!crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(CLEANUP_CRON_SECRET))) { ... }
```

---

## P1 — THIS WEEK

### FIX-04: Token Revocation → Redis (AUTH-03)

**Finding**: Blacklist in-memory perdue à chaque cold start  
**Fichier**: `api/_lib/token-revocation.js`  
**Action**: Ajouter Upstash Redis comme backend principal, in-memory comme fallback

```js
// Architecture:
// 1. Si UPSTASH_REDIS_REST_URL configuré → SET/GET sur Redis avec TTL
// 2. Sinon → in-memory Map (fallback, même comportement qu'actuel)
//
// Clé Redis: "virtumatch:revoke:{sha256(token)}"
// Valeur: JSON { reason, revokedAt }
// TTL: expiresAt - now (auto-cleanup)
```

---

### FIX-05: device-register — Ne pas retourner secret existant (AUTH-02)

**Finding**: `registerDevice()` retourne le secret HMAC sur 409  
**Fichier**: `api/_lib/auth.js`  
**Action**: Sur 409, retourner un flag `alreadyRegistered: true` SANS le secret. Le client doit utiliser un challenge-response pour récupérer le secret :

```js
// AVANT
if (existing?.device_secret) {
  await sql.end();
  return { success: true, device_secret: existing.device_secret, alreadyRegistered: true };
}

// APRÈS (Phase 1 — immédiat)
if (existing?.device_secret) {
  await sql.end();
  // Ne plus retourner le secret existant
  // Le client doit le retrouver via localStorage ou re-register avec un nouveau device_id
  return { success: true, device_secret: null, alreadyRegistered: true };
}
```

**Migration client** : Si le client perd son secret (localStorage clear), il doit générer un nouveau `device_id` et se ré-enregistrer. Les données de l'ancien device_id peuvent être migrées via l'admin migration UI.

---

### FIX-06: HMAC_ONLY=true Activation (AUTH-01)

**Finding**: Fallback `x-device-id` exploitable  
**Prérequis**:
1. Tous les APK clients utilisent HMAC auth (vérifié via monitoring)
2. Taux de fallback < 5% pendant 2 semaines
3. `HMAC_ONLY=true` testé en staging

**Procédure**:
1. Vérifier logs Vercel : `grep "FALLBACK" .` — compter les occurrences
2. Si fallback < 5% : `HMAC_ONLY=true` dans Vercel env
3. Monitor 24h — aucune régression auth
4. Supprimer le code de fallback après 7 jours clean

---

### FIX-07: GDPR Deletion Transaction (DB-02)

**Finding**: 7 DELETE/UPDATE séquentiels sans transaction  
**Fichier**: `api/auth.js` (handleDeleteAccount)  
**Action**: Envelopper dans `sql.begin()`

```js
// APRÈS
await sql.begin(async (tx) => {
  await tx`DELETE FROM magic_links WHERE email = ${email}`;
  await tx`DELETE FROM premium_activations WHERE user_id = ${userId}`;
  await tx`UPDATE access_codes SET used_by_device = NULL WHERE used_by_device IN (
    SELECT device_id FROM device_secrets WHERE ... 
  )`;
  await tx`DELETE FROM predictions WHERE user_id = ${userId}`;
  await tx`DELETE FROM users WHERE id = ${userId}`;
  // etc.
});
```

---

### FIX-08: push-odds.js Transaction + Payload Size Limit (DB-05/DB-06)

**Finding**: DELETE+INSERT non transactionnel ; pas de limite payload  
**Fichier**: `api/push-odds.js`  
**Action**:

```js
// Transaction
await sql.begin(async (tx) => {
  await tx`DELETE FROM scraped_data WHERE data_type = ${dataType} AND league = ${league}`;
  await tx`INSERT INTO scraped_data (...) VALUES (...)`;
});

// Payload size limit
const MAX_PAYLOAD_SIZE = 500_000; // 500 KB
if (JSON.stringify(payload).length > MAX_PAYLOAD_SIZE) {
  return invalidInput(res, 'Payload trop volumineux (max 500 KB)');
}
```

---

### FIX-09: Rate Limiting on analyze-match (AUTH-06)

**Finding**: Aucun rate limiting → abus crédits Groq  
**Fichier**: `api/analyze-match.js`  
**Action**: Ajouter un rate limiter

```js
const analyzeLimiter = createRateLimiter('analyze-match', { max: 10, windowMs: 60 * 1000 }); // 10/min

// Dans le handler
const clientIp = getClientIp(req);
const rateLimit = analyzeLimiter.check(clientIp);
if (!rateLimit.allowed) {
  return rateLimited(res, rateLimit.retryAfter);
}
```

---

### FIX-10: Health Endpoint Auth (AUTH-07)

**Finding**: `/api/verify-predictions?action=health` sans auth → leak system info  
**Fichier**: `api/verify-predictions.js`  
**Action**: Exiger au minimum un device auth pour le health endpoint

```js
// AVANT (health endpoint — no auth)
if (action === 'health') {
  return res.status(200).json({ status: 'ok', ... });
}

// APRÈS
if (action === 'health') {
  // Require at least device auth
  const deviceId = await requireAuth(req);
  if (!deviceId) {
    return unauthorized(res, 'Authentification requise');
  }
  return res.status(200).json({ status: 'ok', version: process.env.npm_package_version });
  // Removed: memory, VERCEL_ENV, Node version, DB URL
}
```

---

### FIX-11: CSP connect-src Restriction (CSP-02)

**Finding**: `connect-src 'self' https://*.vercel.app` trop large  
**Fichier**: `vercel.json`  
**Action**: Restreindre au domaine de déploiement

```
connect-src 'self' https://virtual-match-hitifproject.vercel.app
```

---

### FIX-12: session-lifecycle.js Registry Drift (AUTH-09)

**Finding**: Registry montre 30j pour USER_SESSION, code utilise 7j  
**Fichier**: `api/_lib/session-lifecycle.js`  
**Action**: Mettre à jour la registry pour refléter le code actuel

---

## P2 — THIS MONTH

### FIX-13: HMAC Request Binding (HMAC-01)

**Finding**: Signature sur `deviceId:timestamp` seulement — replay cross-endpoint  
**Action**: Étendre la signature à `method:path:timestamp:nonce:bodyHash`

```
canonicalRequest = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`
signature = HMAC-SHA256(secret, canonicalRequest)
```

**Migration strategy** (pour compatibilité Android) :
1. Phase 1 : Serveur accepte ANCIENT format (deviceId:timestamp) ET NOUVEAU format (canonicalRequest)
2. Phase 2 : Client Android migré vers nouveau format
3. Phase 3 : Serveur n'accepte plus que le nouveau format

**Anti-replay** : Cache des nonces utilisés (Redis SET avec TTL = TOKEN_EXPIRY_MS)

---

### FIX-14: Redis Rate Limiting for Handlers (AUTH-05)

**Finding**: Handlers utilisent `check()` (in-memory) au lieu de `checkDistributed()`  
**Action**: Migrer les handlers sensibles vers `checkDistributed()`

```js
// AVANT
const rateLimit = adminLimiter.check(clientIp);

// APRÈS
const rateLimit = await adminLimiter.checkDistributed(clientIp);
```

Appliquer pour : auth-email, auth-ip, device-register, admin-login, premium-activate.

---

### FIX-15: Missing Database Indexes (DB-04)

**Finding**: Index manquants sur colonnes fréquemment queryées  
**Action**: SQL migration

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_predictions_device_id ON predictions(device_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_predictions_status ON predictions(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_premium_activations_user_id ON premium_activations(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_premium_activations_device_id ON premium_activations(device_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_access_codes_code ON access_codes(code);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scraped_data_type_league ON scraped_data(data_type, league);
```

---

### FIX-16: Cron Concurrent Lock (CRON-02)

**Finding**: Pas de lock → double exécution possible  
**Action**: `pg_advisory_lock` en début de handler

```js
const [lockResult] = await sql`SELECT pg_try_advisory_lock(hashtext('auto-playout')) as acquired`;
if (!lockResult?.acquired) {
  log.info('Another instance is already running — skipping');
  await sql.end();
  return res.status(200).json({ success: true, message: 'Already running' });
}
// ... do work ...
// Lock released automatically when connection ends (sql.end())
```

---

## P3 — NEXT QUARTER

### FIX-17: Token Revocation → Redis Full Implementation
### FIX-18: CSP Nonce/Hash for inline styles
### FIX-19: TypeScript strict mode
### FIX-20: Model versioning in stored predictions
### FIX-21: Prediction engine refactoring

---

## IMPLEMENTATION ORDER

| Phase | Fix IDs | Description | Effort |
|-------|---------|-------------|--------|
| P0 (today) | 01, 02, 03 | Connection leak, crons, cleanup auth | 2h |
| P1a (this week) | 04, 05, 07, 08 | Revocation Redis, device-register, GDPR tx, push-odds | 4h |
| P1b (this week) | 09, 10, 11, 12 | Rate limits, health auth, CSP, registry | 2h |
| P1c (next week) | 06 | HMAC_ONLY=true activation (monitoring first) | 1h |
| P2a (this month) | 13, 14 | HMAC request binding, Redis rate limits | 6h |
| P2b (this month) | 15, 16 | Indexes, cron lock | 2h |

**Total estimated effort**: ~17h

---

## VERIFICATION CHECKLIST

Après chaque fix, vérifier :

- [ ] FIX-01: `admin-codes` appels successifs → pool stable ( Neon dashboard)
- [ ] FIX-02: Vercel cron invocations → 200 (pas 401) dans deployment logs
- [ ] FIX-03: Data cleanup exécution → magic_links/predictions supprimés
- [ ] FIX-04: Revoke token → cold start → token still rejected
- [ ] FIX-05: `device-register` avec device existant → pas de secret retourné
- [ ] FIX-06: `HMAC_ONLY=true` → `x-device-id` seul → 401
- [ ] FIX-07: GDPR deletion → atomique (toutes les tables nettoyées)
- [ ] FIX-08: push-odds → DELETE+INSERT atomique
- [ ] FIX-09: analyze-match → 11ème requête/min → 429
- [ ] FIX-10: health endpoint sans auth → 401
- [ ] FIX-11: CSP connect-src → connexion vers `*.vercel.app` → bloquée
- [ ] FIX-12: session-lifecycle registry → USER_SESSION = 7 days
