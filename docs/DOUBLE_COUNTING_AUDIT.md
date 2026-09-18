# DOUBLE COUNTING AUDIT — Phase 4
Date: 2026-09-18T13:16:02.156Z

## Summary

Total findings: 6
High severity: 2
Medium severity: 2
Low severity: 2

## [MEDIUM] odds → grid search → stats adjustment

Odds are used to compute initial lambdas via grid search, then stats adjustment re-uses odds-derived lambdas as the base (STAT_BASE_WEIGHT=0.70). The same odds information is present in both steps.

**Sources**:
- ÉTAPE 1: convertOddsToProbabilities
- ÉTAPE 2: gridSearchLambdas
- ÉTAPE 4: adjustLambdasWithStats (STAT_BASE_WEIGHT)

**Evidence**: STAT_BASE_WEIGHT=0.70 means 70% of the final lambda comes from odds. The grid search already optimized lambdas to match odds-implied probabilities. Then stats adjustment blends odds-based lambda with attack/defense stats, effectively counting odds strength twice.

## [HIGH] form → momentum

Momentum is derived from form (weighted points from recent matches). Form is also used directly in lambda adjustment (FORM_ATTACK_BOOST, FORM_DEFENSE_PENALTY). The same match results influence both form adjustment AND momentum-derived adjustment.

**Sources**:
- ÉTAPE 3: extractTeamForm (formScores, avgScored, avgConceded)
- ÉTAPE 5: adjustLambdasWithHistory (formAdjustment)
- MOMENTUM_SCALE applied to momentumScore derived from form

**Evidence**: formScores → momentumScore (weighted points / max points × 100). Then: formAdjustment = (avgScored - VIRTUAL_AVG_GOALS) × FORM_ATTACK_BOOST. AND momentum adjustment via MOMENTUM_SCALE. Same underlying data (recent match results) used twice.

## [MEDIUM] stats → attack strength → form

TeamStats.avgGoalsScored and form.avgScored may overlap. Stats cover the full season, form covers last 5 matches. If the last 5 matches are included in the full season stats, their goal contribution is counted in both.

**Sources**:
- ÉTAPE 4: adjustLambdasWithStats (attackStrength, defenseWeakness)
- ÉTAPE 5: adjustLambdasWithHistory (formAdjustment)

**Evidence**: attackStrength = avgGoalsScored / VIRTUAL_AVG_GOALS. formAdjustment = (form.avgScored - VIRTUAL_AVG_GOALS) × FORM_ATTACK_BOOST. If a team scored heavily in recent matches, both attackStrength AND form boost increase lambda.

## [HIGH] AI → may already incorporate odds/stats/form

The AI (Groq LLM) receives match context including odds and may already internalize the same information that the mathematical model computes. AI_WEIGHT=0.35 blends AI probabilities with the Poisson matrix, potentially double-counting odds information.

**Sources**:
- ÉTAPE 7: blendWithAI (AI_WEIGHT=0.35)
- AI input: receives odds, team names, league context

**Evidence**: AI is prompted with match details including odds. It may predict based on the same odds that already drove grid search. Then AI_WEIGHT=0.35 blends this back. If AI agrees with odds, the combined probability overweights the odds-based prediction.

## [LOW] H2H → may overlap with form

H2H matches between two teams are also part of each team's recent form. If a home match against the away team is in the last 5 form matches, that match contributes to BOTH form calculation AND H2H bias.

**Sources**:
- ÉTAPE 5: adjustLambdasWithHistory (h2hAdjustment)
- ÉTAPE 3: extractTeamForm includes all recent matches

**Evidence**: H2H uses historicalResults filtered for specific opponent. Form uses all recent matches regardless of opponent. If Team A played Team B recently, that match is in both form and H2H. However, H2H bias is typically from older matches, reducing overlap.

## [LOW] anti-trap → confidence → probability

Anti-trap detection modifies confidence score (additive bonuses/penalties). Confidence is used for display but also affects the perceived reliability of probabilities. If confidence-boosted predictions are used in LogLoss/Brier calculations with the original probabilities, there may be a mismatch.

**Sources**:
- ÉTAPE 9: determineMainScore (isAntiTrap)
- ÉTAPE 13: calculateMultiFactorConfidence

**Evidence**: Confidence is a heuristic score (25-82%), not a calibrated probability. It does not directly modify prob_home/prob_draw/prob_away. However, if users interpret confidence as probability reliability, there may be a conceptual double-counting with the actual calibrated probabilities.
