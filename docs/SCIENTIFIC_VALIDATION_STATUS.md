# SCIENTIFIC VALIDATION STATUS — Phase 4

Date: 2026-09-18
Commit: 3c7e747
Model: VirtuMatch Predictor v2.0.0

---

# **NOT VALIDATED**

---

## Determination Criteria

| Status | Condition |
|--------|-----------|
| **VALIDATED** | All leakage gates pass, Backtest B valid, sufficient data, no double counting |
| **PARTIALLY_VALIDATED** | Backtest A runs (odds validated), but full model cannot be verified |
| **NOT VALIDATED** | Insufficient data or critical gate failures |

This status was determined **solely by documented criteria**, never by the desire to obtain a positive result.

---

## Current Status Details

| Criterion | Status |
|-----------|--------|
| Neon database connected | ✗ No |
| Predictions available | 0 |
| Backtest A (Odds-Validated) | Not Run (no data) |
| Backtest B (Full Model) | NOT VALIDATED |
| Leakage Gate (10 conditions) | 2/10 pass |
| Coefficient calibration | 0/42 empirically calibrated |
| Double counting | 6 paths found (2 HIGH) |
| Momentum independence | NOT INDEPENDENT (derived from form) |

---

## What Is Validated

1. **The framework infrastructure** — Complete backtest, ablation, calibration, CI, significance testing, walk-forward, and leakage gate frameworks are built and tested
2. **The prediction engine code** — 13-step pipeline is audited; types and interfaces are verified
3. **The coefficient registry** — Validation logic (bounds, conservation laws, monotonicity) passes
4. **Temporal reconstruction** — getFormAtTimestamp, getH2HAtTimestamp, getStatsAtTimestamp correctly filter by timestamp
5. **Anti-leakage code** — No temporal violations detected in the reconstruction functions
6. **Migration 006** — Retrocompatible, nullable columns, proper indexes
7. **Tests** — 938 API tests + 48 frontend tests pass

---

## What Is NOT Validated

1. **Form (last 5 matches)** — UNKNOWN for predictions without feature_snapshot
2. **H2H (head-to-head)** — UNKNOWN for predictions without feature_snapshot
3. **Stats/Team rankings** — UNKNOWN for predictions without feature_snapshot
4. **AI prediction** — UNKNOWN (Groq LLM output not stored in snapshot)
5. **Anti-trap detection** — UNKNOWN (depends on form + rankings, both UNKNOWN)
6. **Momentum** — NOT INDEPENDENT (deterministically derived from form — double counting confirmed)
7. **AI_WEIGHT = 0.35** — ARBITRARY, not empirically calibrated
8. **VIRTUAL_AVG_GOALS = 1.3** — ARBITRARY, the most impactful coefficient
9. **All 15 arbitrary coefficients** — No empirical basis
10. **All 27 heuristic coefficients** — Reasonable but uncalibrated
11. **Calibration** — No Platt scaling, no isotonic regression, no beta calibration applied
12. **Model vs baselines** — Cannot determine if VirtuMatch beats normalized odds without data
13. **Absence of data leakage for old predictions** — Cannot prove without snapshots

---

## Key Findings (Phase 4)

### Engine Behavior
- The Poisson model (without form/H2H/AI) diverges only **0.03%** from normalized odds on average
- **0 prediction reversals** vs odds across 10 test combinations
- The model is essentially a sophisticated odds normalizer when no contextual data is provided

### Double Counting (6 paths, 2 HIGH)
1. **[HIGH] form → momentum**: Same match results used for both form adjustment AND momentum-derived lambda adjustment
2. **[HIGH] AI → odds**: AI receives odds in context, then its output is blended at 35%, potentially over-weighting odds information
3. **[MEDIUM] odds → grid search → stats adjustment**: Odds used in grid search, then again as 70% of stats adjustment base
4. **[MEDIUM] stats → attack strength → form**: avgGoalsScored may overlap with form.avgScored
5. **[LOW] H2H → form**: Recent H2H matches may be in both H2H and form
6. **[LOW] anti-trap → confidence**: Confidence is heuristic, not a probability

### Coefficients
- **42 coefficients total**: 15 arbitrary, 27 heuristic, **0 empirically calibrated**
- **VIRTUAL_AVG_GOALS = 1.3** (arbitrary): THE most impactful coefficient
- **AI_WEIGHT = 0.35** (arbitrary): 35% of prediction comes from unvalidated AI

---

## Recommendations for Phase 5

### Immediate (before any coefficient modification)
1. **Set NEON_DATABASE_URL** in the analysis environment to enable real backtesting
2. **Verify migration 006** is applied on production Neon
3. **Enable feature_snapshot** for all new predictions
4. **Collect 100+ verified predictions with snapshots** before re-running Phase 4
5. **Re-run `npm run backtest:real`** with database access

### After data collection (Phase 5)
1. **Calibrate VIRTUAL_AVG_GOALS** first — it has the highest impact on lambda calculations
2. **Run AI_WEIGHT sweep on VALIDATION** — test 0.00 to 0.35, select best, evaluate once on TEST
3. **Address form→momentum double counting** — either remove momentum as independent feature, or ensure it provides genuinely orthogonal information
4. **Train calibration** (Platt scaling or isotonic regression) on TRAIN+VALIDATION only
5. **Run full ablation** on TEST set with real data to determine which features actually help
6. **Consider simplifying the model** — if odds-only performs similarly to full model on TEST, the extra complexity is not justified

### Never
- Never optimize on TEST
- Never convert UNKNOWN to SAFE
- Never transform "framework implemented" into "model scientifically validated"
- Never modify coefficients before completing the initial statistical analysis

---

## Reports Produced

| Report | Path |
|--------|------|
| Real Backtest Report | `docs/REAL_BACKTEST_REPORT.md` |
| Model Comparison | `docs/MODEL_COMPARISON.md` |
| Calibration Report | `docs/CALIBRATION_REAL_REPORT.md` |
| Ablation Report | `docs/ABLATION_REAL_REPORT.md` |
| Double Counting Audit | `docs/DOUBLE_COUNTING_AUDIT.md` |
| Leakage Final Report | `docs/LEAKAGE_FINAL_REPORT.md` |
| 18 Questions | `docs/EIGHTEEN_QUESTIONS.md` |
| Engine Behavior | `docs/ENGINE_BEHAVIOR_ANALYSIS.md` |
| Coefficient Audit | `docs/COEFFICIENT_CALIBRATION_AUDIT.md` |
| Walk-Forward | `docs/WALK_FORWARD_REPORT.md` |
| Temporal Integrity | `docs/DATASET_TEMPORAL_INTEGRITY_REPORT.md` |
| AI Weight Validation | `docs/AI_WEIGHT_VALIDATION.md` |
| Results (JSON) | `download/REAL_BACKTEST_RESULTS.json` |
| Analysis (JSON) | `download/PHASE4_ANALYSIS.json` |
| Reproducibility Meta | `download/REPRODUCIBILITY_META.json` |
