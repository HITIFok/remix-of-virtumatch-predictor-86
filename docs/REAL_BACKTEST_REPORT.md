# REAL BACKTEST REPORT — Phase 4
Date: 2026-09-18T13:16:02.155Z
Commit: 3c7e747

---

## 1. EXECUTIVE SUMMARY

**Scientific Validation Status: NOT VALIDATED**

This report presents the empirical validation of the VirtuMatch Predictor against real historical data from Neon PostgreSQL.

- **Neon Database Connected**: No
- **Migration 006 Applied**: No/Unknown
- **Total Predictions Analyzed**: 0
- **Backtest A (Odds-Validated)**: Not Run
- **Backtest B (Full Model)**: NOT VALIDATED
- **Leakage Gate**: NOT VALIDATED

> ⚠️ **FULL MODEL VALIDATION PENDING — INSUFFICIENT HISTORICAL SNAPSHOT COVERAGE**
>
> The Neon PostgreSQL database was not accessible from the analysis environment.
> Without real historical data, the full model cannot be empirically validated.
> The odds-only backtest framework is built and ready to execute when database access is available.

## 2. DATASET

| Metric | Value |
|--------|-------|
| Total predictions in DB | 0 |
| With actual result | 0 |
| Without result | 0 |
| No valid odds | 0 |
| Cancelled | 0 |
| Test/Simulation | 0 |
| Duplicates | 0 |
| With feature_snapshot | 0 |
| Without feature_snapshot | 0 |
| RECORDED | 0 |
| RECONSTRUCTED | 0 |
| UNKNOWN | 0 |
| UNSAFE | 0 |
| Temporal violations | 0 |

**Deduplication rule**: For same match + same date: keep earliest prediction with highest confidence

## 3. BACKTEST A — ODDS VALIDATED

Uses only predictions where odds are verifiably known at prediction time.
This is the scientifically safest backtest because odds are always RECORDED in the predictions table.

*No data available for Backtest A.*

## 4. BACKTEST B — FULL MODEL

**STATUS: NOT VALIDATED**

Insufficient predictions with valid feature_snapshot to validate the full model.
The following criteria must ALL be met:
- feature_snapshot exists
- provenance ≠ UNKNOWN and ≠ UNSAFE
- temporal_valid = true
- feature_snapshot_hash present
- model_version present

> **FULL MODEL VALIDATION PENDING — INSUFFICIENT HISTORICAL SNAPSHOT COVERAGE**

## 5. TEMPORAL SPLIT

*Insufficient data for temporal split.*

## 6. CALIBRATION

*Insufficient data for calibration analysis.*

## 7. CONFIDENCE INTERVALS (Bootstrap, 95%)

*Insufficient data for bootstrap confidence intervals.*

## 8. SIGNIFICANCE TESTS

*Insufficient data for significance tests.*

## 9. LEAKAGE GATE FINAL

| Condition | Status |
|-----------|--------|
| 1. Snapshot valid | ✗ |
| 2. Hash valid | ✗ |
| 3. Timestamps consistent | ✓ |
| 4. No future features | ✓ |
| 5. Source identifiable | ✗ |
| 6. Computation reproducible | ✗ |
| 7. Model version known | ✗ |
| 8. Feature version known | ✗ |
| 9. Config known | ✓ |
| 10. Calibration known | ✗ |

**LEAKAGE GATE RESULT: NOT VALIDATED**

## 10. LIMITATIONS

- **No database access**: The Neon PostgreSQL database was not accessible. All results are based on code analysis, not empirical data.
- **No historical predictions**: Without real prediction data, no empirical validation is possible.
- **Full model not validated**: Insufficient feature_snapshot coverage prevents full model validation.
- **Calibration not trained**: No Platt scaling or isotonic regression has been applied. Raw model probabilities are used.
- **AI influence unvalidated**: AI_WEIGHT=0.35 is arbitrary. The AI's contribution has not been empirically measured against a held-out test set.
- **Momentum is derived from form**: Momentum does not provide independent information; it is a deterministic function of form results.
- **Double counting detected**: See DOUBLE_COUNTING_AUDIT.md for identified information redundancy paths.
