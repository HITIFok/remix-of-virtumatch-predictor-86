# TODO Sécurité — Suivi des vulnérabilités et actions futures

> Dernière mise à jour : 2026-08-20
> Audit initial : 31 vulnérabilités (3 critique, 6 haute, 8 modérée, 8 basse, 6 info)
> Statut actuel : **0 vulnérabilité npm**

---

## Résolu — React Router v6 → v7 (anciennement 2 CVE modérées)

### CVE concernées (résolues par migration v7)

| CVE | Titre | Sévérité | Package | Statut |
|-----|-------|----------|---------|--------|
| GHSA-wrjc-qvh5-2r2w | Open redirect via backslash in URL | Moderate | react-router | **Résolu** (v7.18.2) |
| GHSA-337j-4v33-4m4m | Arbitrary constructor injection via SSR hydration | Moderate | react-router-dom | **Résolu** (v7.18.2) |

### Pourquoi ces CVE n'étaient pas urgentes

- **Pas de SSR** : VirtuMatch est un SPA Vite pur, déployé comme assets statiques sur Vercel.
  GHSA-337j nécessite un serveur Node.js qui fait du rendu SSR — inapplicable.
- **Pas de navigation par URL utilisateur** : Les routes sont naviguées par composants React
  (`useNavigate`, `Link`), pas par saisie d'URL brute. Le vecteur d'attaque open redirect
  est donc limité.

### Scan d'usage pré-migration (réalisé avant la migration)

**API utilisée** : Déclarative classique uniquement (BrowserRouter mode).
Aucune Data Router API (`createBrowserRouter`, `loader`, `action`, `RouterProvider`).

| API | Fichier(s) |
|-----|-----------|
| `BrowserRouter` | `src/App.tsx` |
| `Routes`, `Route` | `src/App.tsx` (8 routes) |
| `useNavigate` | `BottomNav.tsx`, `AppHeader.tsx`, `Admin.tsx` |
| `useLocation` | `BottomNav.tsx`, `AppHeader.tsx`, `NotFound.tsx` |
| `Link` | `NotFound.tsx` |
| `NavLink` | `NavLink.tsx` (wrapper, inutilisé dans l'app) |

**Estimation d'effort de migration** : Faible — l'usage était 100% API déclarative classique,
entièrement supportée par v7 sans changements. Seul le type `NavLinkProps` (supprimé en v7)
a nécessité un ajustement mineur (`ComponentPropsWithoutRef` à la place).

**Guide de migration officiel** : https://reactrouter.com/upgrading/v6

---

## Actions futures (non urgentes)

### 1. Supprimer le fallback device_id en clair

Le module `requireAuth()` dans `api/_lib/auth.js` accepte encore les `x-device-id` en clair
pendant la période de migration HMAC (~2 semaines après déploiement APK mis à jour).

**Fichier** : `api/_lib/auth.js` — bloc `// BACKWARD COMPAT`

### 2. Rate limiting persistant (serverless)

Le rate limiting actuel utilise un `Map` en mémoire qui se réinitialise à chaque cold start.
Pour une protection réelle en production, migrer vers Upstash Redis.

**Fichiers** : `api/predictions.js`, `api/premium-activate.js`, `api/admin-login.js`, `api/device-register.js`

### 3. Content-Security-Policy : supprimer `unsafe-inline` pour les scripts

Le CSP actuel dans `vercel.json` autorise `script-src 'unsafe-inline'`, ce qui désactive
une protection XSS majeure. Vite hache déjà les noms de fichiers JS — ajouter des nonces
CSP permettrait de supprimer `unsafe-inline`.

**Fichier** : `vercel.json` → header `Content-Security-Policy`

---

## Historique des commits de sécurité

| Date | Commit | Description |
|------|--------|-------------|
| 2026-08-20 | `0b7ef94` | Remove ambiguous bun lockfiles, pin npm |
| 2026-08-20 | `23891de` | HMAC device auth + react-router v7 (0 vulns) |
| 2026-08-20 | `b700e3d` | Fix 3 critical + 6 high vulnerabilities |
| 2026-08-20 | `7523d92` | Vite 5→8, plugin-react-swc 3→4 |
| 2026-08-20 | `f846964` | react-router-dom 6.30.1→6.30.4 (XSS patch) |