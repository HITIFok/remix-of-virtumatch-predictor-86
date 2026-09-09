# TODO Sécurité — Suivi des vulnérabilités et actions futures

> Dernière mise à jour : 2026-09-09
> Audit initial : 31 vulnérabilités (3 critique, 6 haute, 8 modérée, 8 basse, 6 info)
> Statut actuel : **0 vulnérabilité npm**
> Phase A (V-01 + V-02) : **CORRIGÉE** ✅

---

## Résolu — React Router v6 → v7 (anciennement 2 CVE modérées)

### CVE concernées (résolues par migration v7)

| CVE | Titre | Sévérité | Package | Statut |
|-----|-------|----------|---------|--------|
| GHSA-wrjc-qvh5-2r2w | Open redirect via backslash in URL | Moderate | react-router | **Résolu** (v7.18.2) |
| GHSA-337j-4v33-4m4m | Arbitrary constructor injection via SSR hydration | Moderate | react-router-dom | **Résolu** (v7.18.2) |

---

## Phase A — Corrections appliquées (2026-09-09)

### V-01 ✅ CORRIGÉ : Fallback device_id restreint + feature flag HMAC_ONLY

**Fichier** : `api/_lib/auth.js` — `requireAuth()` (lignes 190-236)

**Corrections :**
1. Feature flag `HMAC_ONLY` : quand `process.env.HMAC_ONLY === 'true'`, le fallback est **entièrement désactivé**
2. DELETE interdit via fallback : les opérations destructrices exigent toujours un token HMAC
3. Fallback réduit à `x-device-id` header uniquement : `body.device_id` et `query.device_id` **supprimés**
4. Logging enrichi : chaque fallback loggue `method` + `IP` pour détection d'abus
5. Client `src/lib/device.ts` : commentaires de migration ajoutés, fallback signalé comme temporaire

**Fichier** : `api/auth.js` — `purpose=migrate` : logging ajouté pour traçabilité

**Prochaines étapes :**
- [ ] Phase B : Tests de sécurité automatisés pour requireAuth()
- [ ] Déployer APK avec getAuthHeaders() HMAC
- [ ] Après 2 semaines : activer `HMAC_ONLY=true` en production
- [ ] Supprimer le code de fallback entièrement

### V-02 ✅ CORRIGÉ : Bypass x-capacitor-request supprimé

**Fichier** : `api/_lib/cors.js` — `isOriginAllowed()` (lignes 25-53)

**Corrections :**
1. Ligne `if (reqHeaders?.['x-capacitor-request']) return true;` **supprimée**
2. L'authentification des apps natives passe désormais par les tokens HMAC (`Authorization: Device`)
3. Les origines Capacitor (`capacitor://localhost`, `https://localhost`) restent dans ALLOWED_ORIGINS
4. Documentation complète du rationale dans le code source

---

## Actions futures (non urgentes)

### 1. Activer HMAC_ONLY=true en production

Après déploiement APK mis à jour + période de migration (~2 semaines), activer
`HMAC_ONLY=true` puis supprimer le code de fallback dans `requireAuth()`.

**Fichier** : `api/_lib/auth.js` — variable `HMAC_ONLY`

### 2. Rate limiting persistant (serverless)

Le rate limiting actuel utilise un `Map` en mémoire qui se réinitialise à chaque cold start.
Pour une protection réelle en production, migrer vers Upstash Redis.

**Fichiers** : `api/predictions.js`, `api/premium-activate.js`, `api/admin-codes.js`, `api/device-register.js`

### 3. Content-Security-Policy : supprimer `unsafe-inline` pour les scripts (V-03)

Le CSP actuel dans `vercel.json` autorise `script-src 'unsafe-inline'`, ce qui désactive
une protection XSS majeure. Vite hache déjà les noms de fichiers JS — ajouter des nonces
CSP permettrait de supprimer `unsafe-inline`.

**Fichier** : `vercel.json` → header `Content-Security-Policy`
**Phase** : C (après Phase B — tests de sécurité)

---

## Historique des commits de sécurité

| Date | Commit | Description |
|------|--------|-------------|
| 2026-09-09 | Phase A | V-01: HMAC_ONLY flag + restricted fallback in requireAuth() |
| 2026-09-09 | Phase A | V-02: Remove x-capacitor-request CORS bypass |
| 2026-08-20 | `0b7ef94` | Remove ambiguous bun lockfiles, pin npm |
| 2026-08-20 | `23891de` | HMAC device auth + react-router v7 (0 vulns) |
| 2026-08-20 | `b700e3d` | Fix 3 critical + 6 high vulnerabilities |
| 2026-08-20 | `7523d92` | Vite 5→8, plugin-react-swc 3→4 |
| 2026-08-20 | `f846964` | react-router-dom 6.30.1→6.30.4 (XSS patch) |
