# ADR-004: Centralized Prediction Coefficient Registry

**Status**: Adopted  
**Date**: 2024-09-09  
**Phase**: H (Coefficient Calibration)

## Context

17+ prediction coefficients were hardcoded throughout `prediction-engine.ts`, making calibration impossible without code changes. Some coefficients had no empirical basis (marked "arbitrary").

## Decision

Create `prediction-config.ts` as the single source of truth:

1. **Registry**: All 22 coefficients defined with `{ value, min, max, unit, description, calibrationStatus }`
2. **Validation**: `validateCoefficients()` enforces conservation laws at startup
3. **Overrides**: `VIRTUMATCH_COEF_*` env vars for A/B testing (clamped to `[min, max]`)
4. **Priorities**: 6 arbitrary coefficients flagged for calibration

## Conservation Laws

- STAT_BASE_WEIGHT + STAT_ATTACK_WEIGHT + STAT_DEF_WEIGHT = 1.0
- FORM_WEIGHTS monotonically decreasing (1.5 → 1.0)
- GRID_MIN_LAMBDA < GRID_MAX_LAMBDA
- CONF_MAX_BASE < CONF_CAP

## Cross-Term Double-Counting

The STAT_DEF_WEIGHT (0.10) may double-count with grid search lambda adjustment. The config allows reducing to 0.05 via `VIRTUMATCH_COEF_STAT_DEF_WEIGHT=0.05` env var.

## Consequences

- **Positive**: Coefficients can be tuned without code changes
- **Positive**: Validation prevents invalid configurations at startup
- **Positive**: Arbitrary coefficients clearly identified for calibration work
- **Negative**: Slight indirection (coefficients accessed via `_cfg.*`)
