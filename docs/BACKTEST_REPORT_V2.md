# BACKTEST REPORT V2 — VirtuMatch Predictor

**Date:** 2026-09-18T11:53:28.933Z
**Source:** SYNTHETIC (no DB access — results are illustrative only)
**Dataset hash:** 0947911386fe
**Leakage status:** UNKNOWN

---

## Dataset

| Property | Value |
|----------|-------|
| Total verified matches | 613 |
| Train period | 2025-01-01T00:00:00.000Z → 2025-04-17T00:00:00.000Z |
| Train size | 367 |
| Validation period | 2025-04-17T00:00:00.000Z → 2025-05-25T00:00:00.000Z |
| Validation size | 123 |
| Test period | 2025-05-25T00:00:00.000Z → 2025-06-29T00:00:00.000Z |
| Test size | 123 |
| Model version | current-v2.0 |
| Config validation | valid |

## Baseline Results

| Model | N | Accuracy | Bal. Acc. | Log Loss | Brier | ECE | MCE |
|-------|---|----------|----------|---------|-------|-----|-----|
| Majority | 613 | 0.489 | 0.333 | 17.636 | 1.0212 | 0.5106 | 0.5106 |
| Raw Odds | 613 | 0.504 | 0.364 | 0.995 | 0.6011 | 0.0425 | 0.0956 |
| Normalized Odds | 613 | 0.504 | 0.364 | 0.995 | 0.6011 | 0.0425 | 0.0956 |
| Simple Poisson | 613 | 0.504 | 0.364 | 1.067 | 0.6442 | 0.1543 | 0.2621 |
| VirtuMatch Current | 613 | 0.504 | 0.364 | 0.995 | 0.6011 | 0.0423 | 0.0928 |

## Ablation Results

| Variant | N | Accuracy | Log Loss | Brier | ECE | Δ vs Current |
|---------|---|----------|---------|-------|-----|-------------|
| VirtuMatch Current | 613 | 0.504 | 0.995 | 0.6011 | 0.0423 | +0.000 |
| Without AI | 613 | 0.504 | 0.995 | 0.6011 | 0.0423 | +0.000 |
| Without H2H | 613 | 0.504 | 0.995 | 0.6011 | 0.0423 | +0.000 |
| Without Form | 613 | 0.504 | 0.995 | 0.6011 | 0.0423 | +0.000 |
| Without Momentum | 613 | 0.504 | 0.995 | 0.6011 | 0.0423 | +0.000 |
| Without Anti-trap | 613 | 0.504 | 0.995 | 0.6011 | 0.0423 | +0.000 |
| Without Stats | 613 | 0.504 | 0.995 | 0.6011 | 0.0423 | +0.000 |
| Odds Only | 613 | 0.504 | 0.995 | 0.6011 | 0.0423 | +0.000 |
| Poisson Only | 613 | 0.504 | 0.995 | 0.6011 | 0.0423 | +0.000 |

## Calibration

### raw

ECE = 0.0423, MCE = 0.0928, Brier = 0.6011

| Bin | Mean Predicted | Mean Actual | Count | Gap |
|-----|---------------|------------|-------|-----|
| [0.3, 0.4) | 0.385 | 0.421 | 38 | -0.036 |
| [0.4, 0.5) | 0.445 | 0.431 | 197 | 0.013 |
| [0.5, 0.6) | 0.547 | 0.455 | 176 | 0.093 |
| [0.6, 0.7) | 0.655 | 0.624 | 181 | 0.030 |
| [0.7, 0.8) | 0.708 | 0.714 | 21 | -0.006 |

## AI_WEIGHT Sweep (VALIDATION only)

| Weight | Log Loss | Brier | Accuracy | ECE |
|--------|---------|-------|----------|-----|
| 0.00 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 0.05 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 0.10 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 0.15 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 0.20 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 0.25 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 0.30 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 0.35 | 1.034 | 0.6243 | 0.472 | 0.0766 |

## VIRTUAL_AVG_GOALS Sweep (VALIDATION only)

| Value | Log Loss | Brier | Accuracy | ECE |
|-------|---------|-------|----------|-----|
| 0.9 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 1.0 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 1.1 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 1.2 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 1.3 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 1.4 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 1.5 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 1.6 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 1.7 | 1.034 | 0.6243 | 0.472 | 0.0766 |
| 1.8 | 1.034 | 0.6243 | 0.472 | 0.0766 |

## Coefficient Sensitivity

| Coefficient | Baseline | Sensitivity | Direction |
|-------------|----------|------------|----------|
| VIRTUAL_AVG_GOALS | 1.3 | 0.0000 | decrease improves |
| AI_WEIGHT | 0.35 | 0.0000 | decrease improves |
| FORM_ATTACK_BOOST | 0.15 | 0.0000 | decrease improves |
| H2H_HOME_BOOST | 0.5 | 0.0000 | decrease improves |
| MOMENTUM_SCALE | 500 | 0.0000 | decrease improves |
| STAT_ATTACK_WEIGHT | 0.2 | 0.0000 | decrease improves |

## Final Summary

```
DATASET:          613 matches
PERIOD:           2025-01-01T00:00:00.000Z → 2025-04-17T00:00:00.000Z → 2025-05-25T00:00:00.000Z → 2025-06-29T00:00:00.000Z
LEAKAGE:          UNKNOWN

CURRENT MODEL:
  Accuracy:       0.504
  Log Loss:       0.995
  Brier:          0.6011
  ECE:            0.0423

ODDS BASELINE:
  Accuracy:       0.504
  Log Loss:       0.995
  Brier:          0.6011
  ECE:            0.0425

SIMPLE POISSON:
  Accuracy:       0.504
  Log Loss:       1.067
  Brier:          0.6442
  ECE:            0.1543

AI CONTRIBUTION:  MEASURED (see ablation)
CALIBRATION:      MEASURED (ECE=0.0423)
ABLATION:         COMPLETE (9 variants)
REPRODUCIBILITY:  PASS
```

*Framework: Walk-Forward Backtest v1.0 | Timestamp: 2026-09-18T11:53:28.933Z | Hash: 0947911386fe*