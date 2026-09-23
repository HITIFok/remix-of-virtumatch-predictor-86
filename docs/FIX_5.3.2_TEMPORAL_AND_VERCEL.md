# FIX 5.3.2 — Temporal Validation + Vercel Function Limit

**Date**: 2026-09-23
**Commit**: `030f202`

---

## A — Temporal Validation

### Cause

The test `Phase 5: Three Temporal Timestamps > should verify T_feature <= T_prediction` failed on GitHub Actions (passed locally due to lucky timing).

**Two root causes identified:**

1. **AI response_timestamp used as source_timestamp** (`snapshot-audit.ts` line 129):
   - `makeRecord('ai_response_timestamp', 'ai_model', a.response_timestamp || null, ...)` used `response_timestamp` as the `source_timestamp` (3rd argument)
   - `response_timestamp` is an AI OUTPUT, not a source data input
   - `computeTemporalTimestamps()` takes MAX of all `source_timestamp` values as `T_feature`
   - Since `T_AI_response > T_prediction` (AI latency), this pushed `T_feature > T_prediction` → `feature_before_prediction = false`

2. **Derived features use snapshot_timestamp as source_timestamp**:
   - Calculated, system, and config features use `snapshot_timestamp` as `source_timestamp`
   - These are pipeline outputs (e.g., `derived_lambda_home`, `coefficients_hash`, `anti_trap_triggered`), not external source data
   - Including them in MAX computation made `T_feature = snapshot_timestamp > T_prediction`

3. **Non-deterministic fixture timestamps** (`makeSampleSnapshot()`):
   - Used separate `new Date().toISOString()` calls that could drift by milliseconds
   - `odds.source_timestamp = now` and `prediction_timestamp = now` were equal but `ai.response_timestamp` (a fresh `Date.now()` call) could be later

### Timestamps Before Correction

```text
prediction_timestamp = new Date().toISOString()        // call 1
odds.source_timestamp = prediction_timestamp            // same variable
ai.response_timestamp = new Date().toISOString()         // call 2 — possibly +1ms
derived.*.source_timestamp = snapshot_timestamp          // always > prediction

T_feature = MAX(all source_timestamps) = snapshot_timestamp or ai.response_timestamp
T_prediction = prediction_timestamp
Result: T_feature > T_prediction → feature_before_prediction = false (FLAKE)
```

### Definition Retained

- **T_feature**: The latest `source_timestamp` across EXTERNAL SOURCE DATA features only.
  Excludes: calculated, calculated_from_odds, calculated_from_h2h, calculated_from_form, calculated_from_ranking, system, config sources.
  These are pipeline outputs, not external inputs.

- **T_prediction**: The moment the final prediction is produced (`prediction_timestamp`).

- **Temporal invariant**: `T_feature <= T_prediction` (all source data must be available before prediction).

### Correction Applied

1. **`snapshot-audit.ts` line 129**: Changed source_timestamp for `ai_response_timestamp` record from `a.response_timestamp` to `aiTs` (= `a.request_timestamp`). AI response is a computed output; the relevant source timestamp is when inputs were assembled (request time).

2. **`computeTemporalTimestamps()`**: Added `DERIVED_SOURCES` filter to exclude pipeline-output features from T_feature MAX computation. Only external source data timestamps (bookmaker, historical_matches, ai_model) are considered.

3. **`makeSampleSnapshot()` fixture**: Replaced non-deterministic `Date.now()` calls with deterministic timestamps derived from a single `base`:
   ```text
   featureTime     = base - 86400000  (1 day ago)
   aiRequestTime   = base - 3000      (3s before prediction)
   aiResponseTime  = base - 1000      (1s before prediction)
   predictionTime  = base - 500       (0.5s before snapshot)
   snapshotTime    = base              (now)
   ```
   Guarantees: `featureTime < aiRequestTime < aiResponseTime < predictionTime < snapshotTime`

4. **Regression test added**: A test where a source feature has `source_timestamp > prediction_timestamp` → verifies `feature_before_prediction = false` (real leak detected, not masked by the fix).

### Vitest Result

```text
175 passed | 0 failed (frontend)
930 passed | 0 failed (API)
```

---

## B — Vercel

### Initial Function Count

13 serverless functions detected by Vercel (exceeds Hobby limit of 12):

| # | File | Route | Status |
|---|------|-------|--------|
| 1 | `api/admin-codes.js` | `/api/admin-codes` | Kept |
| 2 | `api/analyze-match.js` | `/api/analyze-match` | Kept |
| 3 | `api/auth.js` | `/api/auth` | Kept (consolidated: request, verify, register, refresh-token, delete-account, latest-apk) |
| 4 | `api/auto-playout.js` | `/api/auto-playout` | Kept (consolidated: playout, data-cleanup) |
| 5 | `api/early-alerts.js` | `/api/early-alerts` | Kept |
| 6 | `api/fetch-live.js` | `/api/fetch-live` | Kept |
| 7 | `api/matches.js` | `/api/matches` | Kept |
| 8 | `api/predictions.js` | `/api/predictions` | Kept |
| 9 | `api/premium-activate.js` | `/api/premium-activate` | Kept |
| 10 | `api/push-odds.js` | `/api/push-odds` | Kept |
| 11 | `api/verify-predictions.js` | `/api/verify-predictions` | Kept (consolidated: verify, health, snapshot-health, dataset-export) |
| 12 | `api/auth/request-magic-link.js` | `/api/auth/request-magic-link` | **DELETED** (superseded by auth.js?action=request) |
| 13 | `api/auth/verify-magic-link.js` | `/api/auth/verify-magic-link` | **DELETED** (superseded by auth.js?action=verify) |

### Files Deleted

| File | Route | Consolidated Into | Frontend References |
|------|-------|-------------------|---------------------|
| `api/auth/request-magic-link.js` | `/api/auth/request-magic-link` | `auth.js?action=request` | None (frontend uses `/api/auth?action=request`) |
| `api/auth/verify-magic-link.js` | `/api/auth/verify-magic-link` | `auth.js?action=verify` | None (frontend uses `/api/auth?action=verify`) |

### Auth Matrix Updated

- Removed `/api/device-register` entry (consolidated into `/api/auth?action=register`)
- Updated auth notes to document register action
- Total endpoints: 12 → 11

### Routes Preserved

All routes remain accessible:
- `/api/auth?action=request` — magic link request
- `/api/auth?action=verify` — magic link verification
- `/api/auth?action=register` — device registration (consolidated from device-register)
- `/api/auth?action=refresh-token` — token rotation
- `/api/auth?action=delete-account` — GDPR deletion
- `/api/auto-playout` with `x-cron-action: data-cleanup` — GDPR retention cron
- `/api/verify-predictions?action=health` — health monitoring
- `/api/verify-predictions?action=snapshot-health` — snapshot health
- `/api/verify-predictions?action=dataset-export` — dataset export

### Final Function Count

**11 serverless functions** (≤ 12 Hobby limit)

### Build Result

```text
npm run build → SUCCESS
dist/assets/History-BuCulYOT.js → EXISTS (28.23 kB)
```

### Vercel Build Result

```text
Git push → Vercel deployment triggered
https://virtual-match-hitifproject.vercel.app/ → HTTP 200
```

### History Chunk Result

```text
GET /assets/History-BuCulYOT.js → HTTP 200, Content-Type: application/javascript; charset=utf-8
NOT text/html → SPA rewrite correctly excludes /assets/
```

### Test Files Updated

| Test File | Changes |
|-----------|---------|
| `auth-matrix.test.js` | 12→11 endpoints, removed device-register from public list, added legacy auth subdir non-existence checks |
| `handler-migration.test.js` | Removed device-register.js from HANDLERS and DB_HANDLERS |
| `refactor.test.js` | Removed device-register.js from REFACTORED_HANDLERS and ipHandlers |
| `handler-integration.test.js` | Replaced device-register.js tests with auth.js register action tests |
| `e2e-framework.test.js` | Updated DEVICE_REGISTER and HEALTH endpoint assertions |

---

## ÉTAT FINAL

```text
FRONTEND_TESTS = PASS
VITEST = 175 passed / 0 failed (frontend) + 930 passed / 0 failed (API)
SERVERLESS_FUNCTIONS = 11
VERCEL_BUILD = PASS
HISTORY_DYNAMIC_IMPORT = PASS
SCIENTIFIC_COLLECTION = NOT READY
```
