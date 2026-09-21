# REPRODUCIBILITY REPORT — Phase 3

Date: 2026-09-18

---

## 1. REPRODUCIBILITY MODEL

A prediction is reproducible if:

```
same feature_snapshot_hash
+ same model_version
+ same config_version
= same prediction_hash
```

If this equation holds, the prediction can be exactly recomputed from the stored snapshot.

---

## 2. HASH SYSTEM

### feature_snapshot_hash

- **Algorithm**: SHA-256
- **Input**: Canonical JSON serialization of the feature_snapshot
- **Canonical form**: Sorted keys at every level, no whitespace (minified), UTF-8 encoding
- **Excluded fields**: `feature_snapshot_hash` and `prediction_hash` (to avoid circular dependency)

**Example**:
```
sha256:a1b2c3d4e5f6... (64 hex chars)
```

### prediction_hash

- **Algorithm**: SHA-256
- **Input**: Canonical JSON of the prediction output
- **Fields included**: prob_home, prob_draw, prob_away, prediction, confidence, exact_score, lambda_home, lambda_away

**Purpose**: Verify that recomputing the prediction from the snapshot produces the same result.

### coefficient_hash

- **Algorithm**: SHA-256
- **Input**: All 34 coefficient values from COEFFICIENT_DEFINITIONS
- **Purpose**: Detect coefficient drift (if coefficients change but the snapshot's hash doesn't match the current config)

---

## 3. REPRODUCIBILITY STATUS

| Status | Meaning | Action |
|--------|---------|--------|
| EXACT_MATCH | Recomputed prediction matches stored prediction hash | No action needed |
| NUMERICAL_DIFFERENCE | Small difference (< 0.01) due to floating-point | Document, acceptable for most purposes |
| NON_REPRODUCIBLE | Significant difference — prediction cannot be reproduced | Investigate cause |
| MISSING_DATA | Snapshot or hash is missing — cannot verify | Cannot determine reproducibility |

---

## 4. REPRODUCIBILITY CHECK IMPLEMENTATION

```typescript
function checkReproducibility(
  storedSnapshot: FeatureSnapshot,      // Snapshot stored at prediction time
  recomputedSnapshot: FeatureSnapshot,   // Snapshot from recomputation
  storedOutput: PredictionOutput,        // Stored prediction result
  recomputedOutput: PredictionOutput,    // Recomputed prediction result
  tolerance: number = 0.001             // Floating-point tolerance
): ReproducibilityResult
```

Returns:
- `status`: EXACT_MATCH | NUMERICAL_DIFFERENCE | NON_REPRODUCIBLE | MISSING_DATA
- `snapshot_hash_match`: Whether the snapshot hashes match
- `prediction_hash_match`: Whether the prediction hashes match
- `max_difference`: Maximum numerical difference across all output fields
- `differences`: Array of individual field differences

---

## 5. REPRODUCIBILITY REQUIREMENTS

For a prediction to be reproducible, ALL of the following must hold:

1. **Feature snapshot exists**: `feature_snapshot IS NOT NULL`
2. **Snapshot hash is valid**: `computeSnapshotHash(snapshot) === snapshot.feature_snapshot_hash`
3. **Model version matches**: The same prediction-engine.ts code is used
4. **Config version matches**: The same coefficient values are used
5. **All features are RECORDED**: No UNKNOWN features (which cannot be reproduced)
6. **No UNSAFE features**: No data leakage (which corrupts the result)

---

## 6. NON-REPRODUCIBLE COMPONENTS

### AI Prediction

The AI (Groq) component is **inherently non-reproducible**:
- The Groq API is non-deterministic (same input may produce different output)
- The model may be updated server-side without notice
- The API may return different results at different temperatures

**Mitigation**: The snapshot captures the AI response at prediction time (score_home, score_away, confidence). If the AI component is disabled during recomputation and the stored AI values are used instead, the prediction can be reproduced.

**Recommendation**: When recomputing for reproducibility verification, use the AI values from the snapshot rather than making a new API call.

### Coefficient Drift

If coefficients change between prediction time and recomputation time:
- The snapshot stores the coefficient values and hash
- If the current config hash doesn't match the snapshot hash, the recomputation should use the snapshot's coefficients
- This is implemented via the `coefficients.values` field in the snapshot

---

## 7. REPRODUCIBILITY TEST SCENARIOS

### Scenario 1: Full snapshot, same model version

```
Given: feature_snapshot with all features RECORDED
When: Recompute using snapshot data + same model version + same config
Then: prediction_hash matches → EXACT_MATCH
```

### Scenario 2: Partial snapshot, reconstructed features

```
Given: feature_snapshot with some features RECONSTRUCTED
When: Recompute using reconstructed data
Then: May produce NUMERICAL_DIFFERENCE (reconstruction may differ slightly)
```

### Scenario 3: No snapshot (legacy prediction)

```
Given: feature_snapshot IS NULL
When: Cannot recompute (no input data available)
Then: MISSING_DATA
```

### Scenario 4: Coefficient change

```
Given: feature_snapshot with config_version "1.0.0"
When: Current config_version is "1.1.0" (coefficients changed)
Then: Use snapshot's coefficients for recomputation
      If prediction matches → EXACT_MATCH
      If prediction differs → NON_REPRODUCIBLE (document coefficient change impact)
```

---

## 8. CURRENT REPRODUCIBILITY STATUS

| Component | Reproducible? | Reason |
|-----------|---------------|--------|
| Odds → probabilities | YES | Deterministic formula |
| Grid search → lambdas | YES | Deterministic search (same grid, same step) |
| Form extraction | CONDITIONAL | Requires same historical results in same order |
| H2H extraction | CONDITIONAL | Requires same historical results |
| Stats adjustment | CONDITIONAL | Requires same ranking data |
| AI blend | NO | Non-deterministic API |
| Virtual redistribution | YES | Deterministic |
| Anti-trap detection | CONDITIONAL | Depends on form + stats + H2H + AI |
| Confidence calculation | CONDITIONAL | Depends on all above |
| Score matrix | YES | Deterministic from lambdas |

### Overall

**Without feature_snapshot**: NOT REPRODUCIBLE (input data not stored)  
**With feature_snapshot (excluding AI)**: REPRODUCIBLE (all inputs captured)  
**With feature_snapshot (including AI)**: REPRODUCIBLE (AI response captured in snapshot)

---

## 9. IMMUTABILITY GUARANTEE

Once created, a prediction's feature_snapshot must NOT change when:
- Ranking changes
- Form changes (new match results)
- Configuration changes (new coefficients)
- Model changes (engine updates)
- External data changes

This is guaranteed by:
1. **Snapshot is stored at prediction time** — captures the exact state
2. **Hash verification** — any modification to the snapshot invalidates the hash
3. **Version tracking** — model_version, config_version, etc. are immutable
4. **NULL for legacy** — old predictions without snapshots are not retroactively filled

### Test: Hash integrity

```typescript
// After creating snapshot
const hash1 = snapshot.feature_snapshot_hash;

// Modify snapshot
snapshot.odds.odd_home = 999;

// Hash no longer matches
const hash2 = computeSnapshotHash(snapshot);
assert(hash1 !== hash2);  // ✓ Modification detected
```

---

## 10. REPRODUCIBILITY VERIFICATION WORKFLOW

For each historical prediction with a feature_snapshot:

1. Load the stored snapshot and prediction output
2. Verify `feature_snapshot_hash` matches `computeSnapshotHash(snapshot)`
3. If hash doesn't match → **CORRUPTED SNAPSHOT**
4. Recompute the prediction using the snapshot's feature values
5. Compare `computePredictionHash(recomputed)` with stored `prediction_hash`
6. Report status: EXACT_MATCH | NUMERICAL_DIFFERENCE | NON_REPRODUCIBLE | MISSING_DATA

---

## VERDICT

**Reproducibility is ARCHITECTURALLY SUPPORTED** but not yet fully realized because:
- No predictions currently have feature_snapshot (all are NULL)
- The AI component is non-deterministic (captured in snapshot, but not re-callable)
- The coefficient hash can detect drift but doesn't auto-correct it

**Next steps**:
1. Run migration 006 on the database
2. Enable feature_snapshot capture for new predictions
3. After collecting sufficient predictions with snapshots, run reproducibility verification
4. Report EXACT_MATCH rate as a metric of system integrity
