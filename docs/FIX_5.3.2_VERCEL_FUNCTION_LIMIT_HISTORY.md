# Fix 5.3.2 — Vercel Serverless Functions + History Deployment

**Date**: 2026-09-23
**Commit**: `3bd3f58`
**Status**: DEPLOYED — awaiting Vercel build verification

---

## Initial Inventory (27 Serverless Functions)

| # | File | Route | Action Taken |
|---|------|-------|-------------|
| 1 | account-delete.js | /api/account-delete | 🗑️ DELETED → auth.js ?action=delete-account |
| 2 | admin-codes.js | /api/admin-codes | ✅ KEPT |
| 3 | admin-delete-code.js | /api/admin-delete-code | 🗑️ DELETED → admin-codes.js |
| 4 | admin-login.js | /api/admin-login | 🗑️ DELETED → admin-codes.js ?action=login |
| 5 | admin-migrate.js | /api/admin-migrate | 🗑️ DELETED → admin-codes.js ?action=migrate |
| 6 | admin-verify.js | /api/admin-verify | 🗑️ DELETED → admin-codes.js ?action=verify |
| 7 | analyze-match.js | /api/analyze-match | ✅ KEPT |
| 8 | auth.js | /api/auth | ✅ KEPT (absorbed device-register) |
| 9 | auto-playout.js | /api/auto-playout | ✅ KEPT (added ?action=data-cleanup) |
| 10 | check-premium.js | /api/check-premium | 🗑️ DELETED → premium-activate.js GET |
| 11 | data-cleanup.js | /api/data-cleanup | 🗑️ DELETED → auto-playout.js ?action=data-cleanup |
| 12 | dataset-export.js | /api/dataset-export | 🗑️ DELETED → verify-predictions.js ?action=dataset-export |
| 13 | device-register.js | /api/device-register | 🔀 MERGED → auth.js ?action=register |
| 14 | early-alerts.js | /api/early-alerts | ✅ KEPT |
| 15 | fetch-live.js | /api/fetch-live | ✅ KEPT |
| 16 | health.js | /api/health | 🗑️ DELETED → verify-predictions.js ?action=health |
| 17 | latest-apk.js | /api/latest-apk | 🗑️ DELETED → auth.js ?action=latest-apk |
| 18 | matches.js | /api/matches | ✅ KEPT |
| 19 | predictions.js | /api/predictions | ✅ KEPT |
| 20 | premium-activate.js | /api/premium-activate | ✅ KEPT |
| 21 | push-odds.js | /api/push-odds | ✅ KEPT |
| 22 | refresh-token.js | /api/refresh-token | 🗑️ DELETED → auth.js ?action=refresh-token |
| 23 | scrape.js | /api/scrape | 🗑️ DELETED (dead code) |
| 24 | scraped-data.js | /api/scraped-data | 🗑️ DELETED (dead code) |
| 25 | snapshot-health.js | /api/snapshot-health | 🗑️ DELETED → verify-predictions.js ?action=snapshot-health |
| 26 | verify-predictions.js | /api/verify-predictions | ✅ KEPT |

**Deleted: 15 files | Merged: 1 file | Remaining: 11 functions**

---

## Final Serverless Functions (11 ≤ 12 Hobby limit)

| # | File | Route | Description |
|---|------|-------|-------------|
| 1 | admin-codes.js | /api/admin-codes | Admin login, verify, CRUD, migrate |
| 2 | analyze-match.js | /api/analyze-match | Core AI prediction engine |
| 3 | auth.js | /api/auth | Magic link, verify, refresh-token, delete-account, latest-apk, register |
| 4 | auto-playout.js | /api/auto-playout | Playout cron + data-cleanup |
| 5 | early-alerts.js | /api/early-alerts | Early result alerts |
| 6 | fetch-live.js | /api/fetch-live | Live match data from sporty-tech |
| 7 | matches.js | /api/matches | Match/ranking/results proxy |
| 8 | predictions.js | /api/predictions | Prediction CRUD + PATCH |
| 9 | premium-activate.js | /api/premium-activate | Premium status + activation |
| 10 | push-odds.js | /api/push-odds | Scraper data ingestion |
| 11 | verify-predictions.js | /api/verify-predictions | Verify + health + snapshot-health + dataset-export |

---

## Routes Preserved

| Old Route | New Route | Status |
|-----------|-----------|--------|
| /api/refresh-token | /api/auth?action=refresh-token | ✅ Migrated |
| /api/account-delete | /api/auth?action=delete-account | ✅ Migrated |
| /api/data-cleanup | /api/auto-playout?action=data-cleanup | ✅ Migrated (cron updated) |
| /api/health | /api/verify-predictions?action=health | ✅ Migrated |
| /api/snapshot-health | /api/verify-predictions?action=snapshot-health | ✅ Migrated |
| /api/dataset-export | /api/verify-predictions?action=dataset-export | ✅ Migrated |
| /api/admin-login | /api/admin-codes?action=login | ✅ Already migrated |
| /api/admin-verify | /api/admin-codes?action=verify | ✅ Already migrated |
| /api/admin-delete-code | /api/admin-codes (POST with codeId) | ✅ Already migrated |
| /api/admin-migrate | /api/admin-codes?action=migrate | ✅ Already migrated |
| /api/latest-apk | /api/auth?action=latest-apk | ✅ Already migrated |
| /api/check-premium | /api/premium-activate (GET) | ✅ Superseded |
| /api/device-register | /api/auth?action=register | ✅ Merged |
| /api/scrape | (dead code, no callers) | ✅ Removed |
| /api/scraped-data | /api/matches?mode=cache | ✅ Superseded |

---

## Vercel.json Changes

### SPA Rewrite
```json
"source": "/((?!api/.*|assets/.*).*)",
"destination": "/index.html"
```
Excludes both `/api/` and `/assets/` — prevents JS chunk MIME errors.

### Crons
```json
"crons": [
  { "path": "/api/auto-playout", "schedule": "0 6 * * *" },
  { "path": "/api/verify-predictions", "schedule": "0 6 * * *" },
  { "path": "/api/auto-playout?action=data-cleanup", "schedule": "0 3 * * *" }
]
```
3 AM cron now uses query-param `?action=data-cleanup` (Vercel Cron can't send custom headers).

---

## Build Result

```
✓ built in 1.53s
dist/assets/History-BuCulYOT.js    28.23 kB │ gzip: 6.88 kB
```

## Tests Result

```
Test Files  5 passed (5)
Tests       173 passed (173)
```

## Deployment Verification Checklist

- [ ] Vercel build: SUCCESS (no 12-function limit error)
- [ ] `/assets/History-BuCulYOT.js` → HTTP 200, Content-Type: application/javascript
- [ ] `/history` → loads History tab, no MIME error
- [ ] `/api/auth?action=register` → device registration works
- [ ] `/api/auto-playout?action=data-cleanup` → data cleanup works via cron
- [ ] All SPA routes (`/`, `/history`, `/live`, `/shop`) → 200, text/html
- [ ] All API routes → not rewritten to index.html

## History Chunk

- **Filename**: `History-BuCulYOT.js`
- **URL**: `https://virtual-match-hitifproject.vercel.app/assets/History-BuCulYOT.js`
- **Expected**: HTTP 200, Content-Type: application/javascript

## Service Worker / PWA

After deployment, the new SW will update automatically (autoUpdate + skipWaiting). If stale references persist, a hard refresh (Ctrl+Shift+R) forces update.

## Scope

This fix touches ONLY:
1. Serverless function consolidation (15 deleted, 1 merged)
2. Frontend config URL updates
3. Vercel.json cron and rewrite rules
4. Test updates to reflect consolidated architecture

No coefficients, weights, prediction algorithms, AI prompts, scientific pipeline, or database schema were modified.
