# Phase 5.3.1 — Production Persistence Debug Report

**Date**: 2026-09-21
**Commit**: `1e5a67d`
**Status**: FIX DEPLOYED — awaiting production verification
**SCIENTIFIC_COLLECTION**: ❌ NOT READY (requires ≥3 new predictions with non-NULL scientific columns in Neon)

---

## 1. Problem Statement

Despite Phase 5.3 code audit confirming all 23 scientific columns were "wired", **real Neon data proves ALL 34 new predictions have ZERO scientific columns populated**:

```sql
SELECT COUNT(*) AS total_new,
       COUNT(feature_snapshot) AS with_feature_snapshot,
       COUNT(ai_context_hash) AS with_ai_context_hash,
       COUNT(ai_trace) AS with_ai_trace,
       COUNT(scientific_collection_eligible) AS with_eligible
FROM predictions WHERE created_at >= '2026-09-21';

-- Result: total_new=34, all others=0
```

Console logs confirmed `aiTraces received: 1` per match — data IS computed and returned by the server. The data is lost somewhere between client receipt and Neon INSERT.

---

## 2. Forensic Pipeline Trace

### Complete Data Flow

```
computeAITraces()          → builds 20-field trace object per match
  ↓
analyze-match response     → { predictions: [...], ai_traces: [...] }
  ↓
LiveMatches.tsx            → data.ai_traces || []  ✅ extracted correctly
  ↓
savePredictionToDb()       → ...(aiTrace || {})    ✅ spread correctly
  ↓
use-predictions.ts         → ...pred spread         ✅ all fields forwarded
  ↓
POST /api/predictions      → validatePrediction()   ✅ all 23 fields accepted
  ↓
INSERT SQL                 → all 23 columns present  ✅
  ↓
Neon                       → ALL SCIENTIFIC COLUMNS = NULL  ❌
```

### Where Data is Lost

The pipeline appears wired at every step, but **two bugs create a cascading failure**:

---

## 3. ROOT CAUSE: Bug #1 — Property Name Mismatch

### The Bug

**`api/predictions.js` line 365** (POST handler return):
```js
return res.status(201).json({ success: true, prediction: mapToCamelCase(saved) });
//                                         ^^^^^^^^^^
//                                         API uses "prediction" key
```

**`src/hooks/use-predictions.ts` line 313** (client response parsing):
```ts
return (savedData?.row || savedData) as Prediction;
//              ^^^
//              Client reads "row" key — UNDEFINED!
```

### The Cascade

| Step | Code | Result |
|------|------|--------|
| 1 | `savePredictionToDb(match, result)` (line 557, WITHOUT aiTrace) | POST → **201 Created** → prediction saved to Neon ✅ |
| 2 | `savedData = { success: true, prediction: { id: 'uuid', ... } }` | API response received ✅ |
| 3 | `savedData?.row` | `undefined` ❌ |
| 4 | `savedData?.row \|\| savedData` | Falls through to `{ success: true, prediction: {...} }` |
| 5 | `saved?.id` | `undefined` (top level has `success` and `prediction`, not `id`) ❌ |
| 6 | `predId = saved?.id \|\| null` | `null` ❌ |
| 7 | `if (predId)` → `false` | **predictionIdMap NOT set** ❌ |
| 8 | No `[savePredictionToDb]` log appears | Diagnostic confirms predId is null |

### Why This Matters

`predictionIdMap` is the ONLY mechanism for `enhanceWithAI` to know the prediction's UUID. Without it, the PATCH path is unreachable.

---

## 4. CASCADING FAILURE: Bug #2 — 409 Conflict Silently Drops aiTrace

### The Flow After Bug #1

| Step | Code | Result |
|------|------|--------|
| 9 | `enhanceWithAI` runs → API returns aiTraces | `aiTraces received: 1` ✅ |
| 10 | `predictionIdMap.current.get(matchKey)` | `undefined` (never set in step 7) ❌ |
| 11 | Takes "No existing ID" branch | Console: `"No existing ID for X, saving new prediction with aiTrace"` |
| 12 | `savePredictionToDb(match, result, aiTraces[i])` with aiTrace | POST with scientific fields ✅ |
| 13 | INSERT → **409 Conflict** (prediction already exists from step 1) | `savePrediction` returns `null` ❌ |
| 14 | aiTrace data **LOST** | Prediction in Neon has NULL scientific columns ❌ |

### Evidence from Console

```
[enhanceWithAI] aiTraces received: 1, aiPreds: 1
[enhanceWithAI] No existing ID for Newcastle-Leeds, saving new prediction with aiTrace
[LiveMatches] AI enhanced 1 prediction(s)
```

**Missing**: No `[savePredictionToDb]` log — confirming the save returns null (409 conflict).

---

## 5. Fixes Applied

### Fix #1: Property Name Mismatch (PRIMARY)

**File**: `src/hooks/use-predictions.ts` line 313

```diff
- return (savedData?.row || savedData) as Prediction
+ // Phase 5.3.1 FIX: API returns { prediction: ... } not { row: ... }
+ // Support both shapes for backward compatibility
+ const predictionData = savedData?.prediction || savedData?.row || savedData;
+ console.log(`[savePrediction] POST ${res.status}: id=${predictionData?.id}, has_snapshot=${!!predictionData?.featureSnapshot}, has_ctx_hash=${!!predictionData?.aiContextHash}`);
+ return predictionData as Prediction
```

**Effect**: `saved.id` now correctly resolves to the UUID → `predictionIdMap` is populated → PATCH path in `enhanceWithAI` is taken.

### Fix #2: PATCH-First Logic in savePredictionToDb (ROBUSTNESS)

**File**: `src/pages/LiveMatches.tsx` `savePredictionToDb()`

When `savePredictionToDb` is called with `aiTrace` AND `predictionIdMap` already has an entry for this match, it now **PATCHes first** instead of attempting a redundant INSERT:

```ts
const existingId = predictionIdMap.current.get(matchKey);
if (existingId && aiTrace && Object.keys(aiTrace).length > 0) {
  const patched = await updatePredictionScientificFields(existingId, aiTrace);
  if (patched) return existingId;
  // fall through to INSERT only if PATCH fails
}
```

### Fix #3: Enhanced Diagnostic Logging (OBSERVABILITY)

| Location | Log | Purpose |
|----------|-----|---------|
| `use-predictions.ts` | `[savePrediction] POST {status}: id={id}, has_snapshot={...}` | Verify ID extraction works |
| `LiveMatches.tsx` | `[savePredictionToDb] INSERT/PATCH {matchKey} → {id}` | Track save path taken |
| `LiveMatches.tsx` | `[enhanceWithAI] Trace[0] keys: {keys}` | Verify trace content from API |
| `api/predictions.js` | `[predictions POST] Scientific fields in body: N/14` | Verify fields arrive at API |
| `api/predictions.js` | `[predictions POST] DIAGNOSTIC: id={id}, has_snapshot={...}` | Verify INSERT success |
| `LiveMatches.tsx` | `[enhanceWithAI] No prediction result in state for {key}` | Catch missing prediction state |

---

## 6. Verification Plan

After deployment, make **3 new predictions** and check:

### Step 1: Console Verification

Expected console output for each prediction:
```
[savePrediction] POST 201: id=<uuid>, has_snapshot=true, has_ctx_hash=true
[savePredictionToDb] INSERT Newcastle-Leeds → <uuid>, aiTrace=false, fields=0
[enhanceWithAI] aiTraces received: 1, aiPreds: 1
[enhanceWithAI] Trace[0] keys: feature_snapshot,feature_snapshot_hash,..., has_snapshot=true, has_ctx_hash=true
[enhanceWithAI] PATCHING Newcastle-Leeds → <uuid> with 20 trace fields
[updatePredictionScientificFields] PATCH success: <uuid>
[LiveMatches] AI enhanced 1 prediction(s)
```

### Step 2: Neon SQL Verification

```sql
-- After 3 new predictions, run this query:
SELECT
  COUNT(*) AS total_new,
  COUNT(feature_snapshot) AS with_feature_snapshot,
  COUNT(ai_context_hash) AS with_ai_context_hash,
  COUNT(ai_input_hash) AS with_ai_input_hash,
  COUNT(ai_prompt_hash) AS with_ai_prompt_hash,
  COUNT(ai_response_hash) AS with_ai_response_hash,
  COUNT(ai_model) AS with_ai_model,
  COUNT(ai_prompt_version) AS with_ai_prompt_version,
  COUNT(ai_trace) AS with_ai_trace,
  COUNT(CASE WHEN scientific_collection_eligible = true THEN 1 END) AS with_eligible,
  COUNT(version_freeze) AS with_version_freeze,
  COUNT(completeness_score) AS with_completeness,
  COUNT(temporal_safety_score) AS with_temporal_safety
FROM predictions
WHERE created_at >= '2026-09-21';
-- EXPECTED: all counts > 0 for new predictions
```

### Step 3: Detailed Row Verification

```sql
-- Verify a specific prediction has non-NULL scientific columns:
SELECT id, home_team, away_team,
  feature_snapshot IS NOT NULL AS has_snapshot,
  ai_context_hash IS NOT NULL AS has_ctx_hash,
  ai_input_hash IS NOT NULL AS has_inp_hash,
  ai_prompt_hash IS NOT NULL AS has_prm_hash,
  ai_response_hash IS NOT NULL AS has_res_hash,
  ai_model,
  scientific_collection_eligible,
  completeness_score,
  length(ai_context_hash) AS ctx_hash_len
FROM predictions
WHERE created_at >= '2026-09-21'
  AND feature_snapshot IS NOT NULL
LIMIT 5;
-- EXPECTED: ≥1 rows with all has_* = true
```

---

## 7. CODE VERIFIED vs PRODUCTION VERIFIED

| Aspect | Status | Evidence |
|--------|--------|----------|
| `computeAITraces()` produces correct trace objects | CODE VERIFIED ✅ | 20 fields with correct names, SHA-256 hashes, JSONB objects |
| API returns `ai_traces` in response | CODE VERIFIED ✅ | Line 758: `ai_traces: aiTraces` |
| Client extracts `data.ai_traces` | CODE VERIFIED ✅ | Line 510: `data.ai_traces \|\| []` |
| Client spreads aiTrace into savePrediction | CODE VERIFIED ✅ | Line 406: `...(aiTrace \|\| {})` |
| savePrediction POST includes scientific fields | CODE VERIFIED ✅ | Line 279: `...pred` spread |
| validatePrediction accepts scientific fields | CODE VERIFIED ✅ | Lines 90-111: all 23 fields |
| INSERT SQL includes all 23 columns | CODE VERIFIED ✅ | Lines 311-357: complete column list |
| **Property name mismatch fixed** | CODE VERIFIED ✅ | `savedData?.prediction \|\| savedData?.row \|\| savedData` |
| **PATCH-first logic added** | CODE VERIFIED ✅ | `savePredictionToDb` checks predictionIdMap before INSERT |
| **Scientific columns persist to Neon** | **NOT PRODUCTION VERIFIED** ❌ | Requires ≥3 new predictions with non-NULL columns |

---

## 8. Interdictions (STILL IN EFFECT)

- ❌ No coefficient/weight/model/prompt/Poisson changes
- ❌ No backfill of 419 old predictions
- ❌ SCIENTIFIC_COLLECTION = NOT READY until real Neon proof

---

## 9. Exit Criteria

**SCIENTIFIC_COLLECTION = READY** when:

1. ≥3 new predictions exist in Neon with non-NULL `feature_snapshot`
2. ≥3 new predictions exist in Neon with non-NULL `ai_context_hash`
3. ≥3 new predictions exist in Neon with `scientific_collection_eligible = true`
4. Console logs confirm PATCH path is being taken (not 409 fallback)
5. `ai_context_hash` values are 64-character SHA-256 hex strings

---

## 10. Architectural Note: Two-Save Pattern

The current architecture uses a **two-save pattern**:

1. **Save A** (instant): `savePredictionToDb(match, result)` — saves WITHOUT aiTrace for instant UI feedback
2. **Save B** (async): `enhanceWithAI` → PATCH with aiTrace — updates scientific columns after Groq returns

This is intentional — the user sees the prediction immediately (math), and the scientific data is added asynchronously (AI). With the fixes applied, this pattern now works correctly:

- Save A succeeds → predictionIdMap populated with UUID
- Save B finds UUID in predictionIdMap → PATCHes scientific columns
- Result: prediction in Neon has both core data AND scientific columns

**Alternative architecture** (not implemented, for future consideration):
- Wait for both math + AI before saving → single INSERT with all data
- Trade-off: slower UI feedback (user waits for Groq API ~2-3s)
