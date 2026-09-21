# FEATURE SNAPSHOT IMPLEMENTATION — Phase 3

Date: 2026-09-18  
Status: IMPLEMENTED

---

## 1. IMPLEMENTATION SUMMARY

### Files Created

| File | Purpose |
|------|---------|
| `src/lib/feature-snapshot.ts` | Core snapshot module: creation, validation, hashing, provenance, reproducibility |
| `src/lib/historical-reconstruction.ts` | Temporal reconstruction: getFormAtTimestamp, getH2HAtTimestamp, getStatsAtTimestamp, leakage checks |
| `src/test/feature-snapshot.test.ts` | 30+ tests: creation, validation, timestamps, leakage, reconstruction, reproducibility, no-fake-data |
| `api/_migrations/006_feature_snapshot.sql` | DB migration: JSONB column, versioning, hashes, indexes (retrocompatible) |
| `scripts/backtest-framework-v3.ts` | Enhanced backtest with Two Backtests and provenance |
| `docs/PREDICTION_SCHEMA_AUDIT.md` | Complete predictions table audit |
| `docs/FEATURE_SNAPSHOT_SCHEMA.md` | Feature inventory (80 features) and snapshot schema |

### Files Modified

| File | Changes |
|------|---------|
| `api/predictions.js` | Accepts feature_snapshot, model_version, hashes in POST; returns them in GET |

---

## 2. SNAPSHOT STRUCTURE

The feature snapshot is a versioned JSON structure containing:

```
FeatureSnapshot {
  schema_version: 1
  snapshot_timestamp, prediction_timestamp
  model_version, feature_version, config_version, calibration_version, dataset_version

  odds: { odd_home, odd_draw, odd_away, implied_probs, favorite, favorite_prob, provenance }
  form: { home: TeamFormSnapshot, away: TeamFormSnapshot }
  h2h: { total_matches, home_wins, draws, away_wins, home_team_bias, provenance }
  stats: { home: TeamStatsSnapshot, away: TeamStatsSnapshot }
  ai: { enabled, model, score, confidence, weight, agreement, hashes, provenance }
  anti_trap: { triggered, signals (5), alert_count, provenance }
  derived: { lambda stages, agreements, grid_error, provenance }
  coefficients: { hash, values, provenance }

  feature_snapshot_hash (SHA-256)
  prediction_hash (SHA-256)
}
```

---

## 3. PROVENANCE SYSTEM

| Status | Meaning | When Assigned |
|--------|---------|---------------|
| RECORDED | Feature was captured at prediction time from real data | New predictions with snapshot |
| RECONSTRUCTED | Feature was rebuilt from historical data using temporal functions | Historical predictions where source data exists |
| UNKNOWN | Feature cannot be verified — source data unavailable | Legacy predictions or missing data |
| UNSAFE | Feature uses data from after prediction timestamp (leakage) | Detected by temporal validation |

**Rule: UNKNOWN is never elevated to SAFE. Only proven features are RECORDED.**

---

## 4. HASH SYSTEM

- **feature_snapshot_hash**: SHA-256 of canonical JSON (sorted keys, no whitespace) — excludes hash fields
- **prediction_hash**: SHA-256 of prediction output (prob_home, prob_draw, prob_away, prediction, confidence, exact_score, lambda_home, lambda_away)
- **coefficient_hash**: SHA-256 of all 34 coefficient values

**Reproducibility equation:**
```
same feature_snapshot_hash + same model_version + same config_version = same prediction_hash
```

---

## 5. VERSIONING

| Version | Current Value | Source |
|---------|---------------|--------|
| model_version | 2.0.0 | prediction-engine.ts |
| feature_version | 1.0.0 | feature-snapshot.ts |
| config_version | 1.0.0 | prediction-config.ts |
| calibration_version | 0.0.0 | Not yet implemented |
| dataset_version | unversioned | Scraper |

---

## 6. TEMPORAL VALIDATION

Every feature with a source_timestamp is validated against prediction_timestamp:

```
assert feature.source_timestamp <= prediction_timestamp
```

If violated → provenance is set to UNSAFE, leakage is reported.

Tolerance: AI timestamps are allowed up to 5s after prediction_timestamp (async API call).

---

## 7. DATABASE MIGRATION

Migration `006_feature_snapshot.sql` adds:
- `feature_snapshot` JSONB (nullable — NULL for legacy predictions)
- `model_version`, `feature_version`, `config_version`, `calibration_version`, `dataset_version` TEXT
- `feature_snapshot_hash`, `prediction_hash` TEXT
- `snapshot_timestamp` TIMESTAMPTZ
- `provenance_status` TEXT
- 6 indexes (GIN on JSONB, partial indexes for with/without snapshot)

**Retrocompatible**: No existing data modified. NULL = UNKNOWN provenance.

---

## 8. NO FAKE DATA RULE

Implemented as:
1. Legacy predictions are classified via `classifyLegacyPrediction()` — only odds can be RECORDED
2. Historical predictions without snapshot: all non-odds features = UNKNOWN
3. `createFeatureSnapshot()` only marks features as RECORDED if they were actually provided
4. Missing features default to UNKNOWN, never SAFE
5. Tests verify that UNKNOWN is never elevated to RECORDED

---

## 9. TWO BACKTESTS

| Backtest | Features Used | Validity |
|----------|---------------|----------|
| A — Odds-Validated | Odds only (proven SAFE) | SCIENTIFICALLY VALID |
| B — Full Model | All features | VALID only if feature_snapshot exists for all predictions |

When no feature_snapshot exists, Backtest B reports **NOT VALIDATED**.

---

## 10. API CHANGES

The POST `/api/predictions` endpoint now accepts:
- `feature_snapshot` (JSON object) — stored as JSONB
- `model_version`, `feature_version`, `config_version`, `calibration_version`, `dataset_version`
- `feature_snapshot_hash`, `prediction_hash`

The GET response includes all new fields mapped to camelCase.

---

## 11. SIZE IMPACT

| Component | Size |
|-----------|------|
| Full feature_snapshot (JSONB) | ~2-3 KB per prediction |
| With GIN index | ~3.5 KB per prediction |
| 1000 predictions with snapshot | ~3.5 MB |
| 1000 predictions without snapshot | ~0.5 MB (NULL) |
| Hash columns | ~160 bytes per prediction |

Recommended: JSONB column in same table (not separate) for simplicity. The GIN index enables JSON queries. For >100K predictions, consider partitioning by created_at.
