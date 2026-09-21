# COEFFICIENT CALIBRATION AUDIT — Phase 4
Date: 2026-09-18T13:21:10.319Z

## Summary

- **Total coefficients**: 42
- **Arbitrary** (NO empirical basis — priority for calibration): 15
- **Heuristic** (reasonable but uncalibrated): 27
- **Empirically calibrated**: 0

> **0 coefficients are empirically calibrated.**
> The entire model is based on assumptions and heuristics, not data.

## Arbitrary Coefficients (CRITICAL — Priority 1 for Calibration)

| Coefficient | Value | Description |
|-------------|-------|-------------|
| VIRTUAL_AVG_GOALS | 1.3 | Average goals per team per match in virtual football (THE most impactful coeffic |
| FORM_ATTACK_BOOST | 0.15 | Lambda boost per goal above virtual average from recent form |
| FORM_DEFENSE_PENALTY | 0.1 | Lambda penalty per goal conceded above virtual average |
| H2H_HOME_BOOST | 0.5 | H2H boost factor for home team bias |
| H2H_AWAY_PENALTY | 0.3 | H2H penalty factor for away team |
| AI_WEIGHT | 0.35 | Weight of AI prediction in probability blend (35% = moderate AI influence) |
| DEFAULT_AVG_SCORED | 1.3 | Default average goals scored when no form data available (should match VIRTUAL_A |
| DEFAULT_AVG_CONCEDED | 1.1 | Default average goals conceded when no form data available |
| DEF_PENALTY_SELF | 0.5 | Fraction of defense penalty applied to own lambda (self-correction) |
| DEF_PENALTY_CROSS | 0.3 | Fraction of defense penalty applied to opponent lambda (cross-benefit) |
| H2H_BIAS_DIVISOR | 200 | Divisor for H2H homeTeamBias → lambda adjustment (200 → ±0.15 range) |
| FORM_AGREEMENT_THRESHOLD | 15 | Momentum score difference threshold for form agreement (15-point gap needed) |
| H2H_AGREEMENT_THRESHOLD | 20 | H2H homeTeamBias threshold for H2H agreement (20-point bias needed) |
| HALF_TIME_FACTOR | 0.46 | Lambda scaling factor for half-time score prediction (46% of goals in 1st half) |
| NEW_SEASON_BOOST | 0.22 | Lambda boost for favorite in new season mode (no historical data) |

## Heuristic Coefficients (Priority 2 for Calibration)

| Coefficient | Value | Description |
|-------------|-------|-------------|
| GRID_MIN_LAMBDA | 0.5 | Minimum lambda for grid search (lower bound of goal expectation) |
| GRID_MAX_LAMBDA | 3 | Maximum lambda for grid search (upper bound of goal expectation) |
| GRID_STEP | 0.05 | Grid search resolution step (smaller = more precise, slower) |
| FORM_WEIGHT_0 | 1.5 | Weight for most recent match in form calculation |
| FORM_WEIGHT_1 | 1.3 | Weight for 2nd most recent match |
| FORM_WEIGHT_2 | 1.2 | Weight for 3rd most recent match |
| FORM_WEIGHT_3 | 1.1 | Weight for 4th most recent match |
| FORM_WEIGHT_4 | 1 | Weight for 5th most recent match (oldest) |
| STAT_BASE_WEIGHT | 0.7 | Weight of odds-based lambda in stats adjustment (must sum to 1.0 with ATTACK + D |
| STAT_ATTACK_WEIGHT | 0.2 | Weight of attack strength in stats adjustment |
| STAT_DEF_WEIGHT | 0.1 | Weight of defense weakness cross-term (opponent lambda × defenseWeakness). NOTE: |
| MOMENTUM_SCALE | 500 | Momentum divisor (500 → ±0.10 lambda max adjustment) |
| VIRTUAL_CAP | 3 | Maximum goals per team in virtual football (scores > VIRTUAL_CAP are redistribut |
| CONF_BASE_SCALE | 85 | Scale factor for favorite probability → base confidence |
| CONF_MAX_BASE | 68 | Maximum base confidence before bonuses (virtual football has higher variance) |
| CONF_CAP | 82 | Absolute confidence ceiling (even with all bonuses, never exceed this) |
| LAMBDA_MIN | 0.3 | Lower clamp bound for adjusted lambda (prevents near-zero goal expectation) |
| LAMBDA_MAX | 2.8 | Upper clamp bound for adjusted lambda (prevents unrealistic goal explosion) |
| DEFAULT_MOMENTUM | 50 | Default momentum score when no form data available (neutral = 50) |
| VIRT_REDIST_HIGH | 0.7 | Probability reduction ratio for 3-3 scores in virtual redistribution |
| VIRT_REDIST_LOW | 0.4 | Probability reduction ratio for 3-2/3-1 scores in virtual redistribution |
| NEW_SEASON_LAMBDA_MAX | 3 | Lambda ceiling for new season boost (prevents runaway with boost added) |
| CONF_FLOOR | 25 | Absolute confidence floor (never predict below 25% confidence) |
| ANTI_TRAP_RANK_DIFF | 5 | Minimum rank difference to trigger anti-trap alert (rankDiff >= threshold) |
| ANTI_TRAP_DELTA_THRESHOLD | 0.1 | Delta threshold for anti-trap alert (delta < threshold means odds too close) |
| ODDS_GAP_SEVERE | 0.05 | Severe odds gap threshold (oddsGap < this → -10 confidence) |
| ODDS_GAP_MODERATE | 0.1 | Moderate odds gap threshold (oddsGap < this → -5 confidence) |

## Empirically Calibrated Coefficients

*None. No coefficient has been calibrated on empirical data.*

## Calibration Recommendations

### Phase 5 — After sufficient data collection:

1. **VIRTUAL_AVG_GOALS** (current: 1.3): Calibrate on actual virtual football goal averages. This is THE most impactful coefficient.
2. **AI_WEIGHT** (current: 0.35): Sweep on VALIDATION set. If ablation shows no improvement vs odds-only, consider reducing to 0.10-0.20.
3. **FORM_ATTACK_BOOST / FORM_DEFENSE_PENALTY** (current: 0.15/0.10): Calibrate on historical form vs outcome correlation.
4. **H2H_HOME_BOOST / H2H_AWAY_PENALTY** (current: 0.5/0.3): Validate H2H contribution via ablation.
5. **Momentum**: Consider REMOVING as independent feature (it is derived from form — double counting).
