// ============================================
// DOUBLE COUNTING MEASUREMENT v1.0
// Phase 5 — Measure (NOT fix) double counting
// ============================================
//
// Section 22: The two identified risks:
//   Form → Momentum (momentum is derived from form)
//   AI → Odds (AI may integrate odds information)
//
// IMPORTANT: This module MEASURES double counting.
// It does NOT modify the model.
// Modification requires empirical validation first.

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PredictionResult {
  prediction: '1' | 'X' | '2';
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  confidence: number;
}

export interface DoubleCountingResult {
  variant: string;
  description: string;
  predictions_compared: number;
  /** Correlation between the two contributions */
  correlation: number;
  /** How often both agree (same prediction) */
  agreement_rate: number;
  /** How often predictions differ from full model */
  divergence_rate: number;
  /** Average absolute probability difference */
  avg_prob_diff: number;
  /** Maximum absolute probability difference */
  max_prob_diff: number;
  /** Whether this indicates significant double counting */
  significant: boolean;
}

export interface FormMomentumAudit {
  /** Correlation between form contribution and momentum contribution */
  form_momentum_correlation: number;
  /** Full model results */
  full_model: PredictionResult[];
  /** WITHOUT_FORM: form contribution removed */
  without_form: PredictionResult[];
  /** WITHOUT_MOMENTUM: momentum contribution removed */
  without_momentum: PredictionResult[];
  /** WITHOUT_FORM_AND_MOMENTUM: both removed */
  without_form_and_momentum: PredictionResult[];
  /** Measurement results */
  results: DoubleCountingResult[];
  /** Conclusion */
  conclusion: string;
}

export interface AIOddsAudit {
  /** Full model results */
  full_model: PredictionResult[];
  /** WITHOUT_AI: AI blend removed */
  without_ai: PredictionResult[];
  /** ODDS_ONLY: only odds, no other features */
  odds_only: PredictionResult[];
  /** AI_ONLY: only AI prediction (if possible) */
  ai_only: PredictionResult[] | null;
  /** Measurement results */
  results: DoubleCountingResult[];
  /** Conclusion */
  conclusion: string;
}

// ═══════════════════════════════════════════════════════════════════
// FORM ↔ MOMENTUM DOUBLE COUNTING (Section 22)
// ═══════════════════════════════════════════════════════════════════

/**
 * Measure the double counting between Form and Momentum.
 *
 * Momentum is DERIVED from form (weighted point sum of recent results).
 * This means:
 *   - Form affects lambda through avg_scored/avg_conceded
 *   - Momentum affects lambda through a separate adjustment
 *   - But both are computed from the SAME 5-match window
 *   - This creates double counting: the same match results
 *     influence the prediction through TWO paths
 *
 * Measurement approach:
 *   1. Run Full model
 *   2. Run WITHOUT_FORM (remove form lambda adjustment)
 *   3. Run WITHOUT_MOMENTUM (remove momentum lambda adjustment)
 *   4. Run WITHOUT_FORM_AND_MOMENTUM (remove both)
 *
 * If (Full - WITHOUT_FORM_AND_MOMENTUM) ≈
 *    (Full - WITHOUT_FORM) + (Full - WITHOUT_MOMENTUM)
 *    → NO double counting (effects are independent)
 *
 * If (Full - WITHOUT_FORM_AND_MOMENTUM) >
 *    (Full - WITHOUT_FORM) + (Full - WITHOUT_MOMENTUM)
 *    → DOUBLE COUNTING (effects overlap)
 */
export function measureFormMomentumDoubleCounting(
  fullModel: PredictionResult[],
  withoutForm: PredictionResult[],
  withoutMomentum: PredictionResult[],
  withoutFormAndMomentum: PredictionResult[],
): FormMomentumAudit {
  const n = Math.min(fullModel.length, withoutForm.length, withoutMomentum.length, withoutFormAndMomentum.length);

  const results: DoubleCountingResult[] = [];

  // 1. Full vs WITHOUT_FORM
  results.push(compareVariants(
    'FULL vs WITHOUT_FORM',
    'Full model vs model without form adjustment',
    fullModel, withoutForm, n,
  ));

  // 2. Full vs WITHOUT_MOMENTUM
  results.push(compareVariants(
    'FULL vs WITHOUT_MOMENTUM',
    'Full model vs model without momentum adjustment',
    fullModel, withoutMomentum, n,
  ));

  // 3. Full vs WITHOUT_FORM_AND_MOMENTUM
  results.push(compareVariants(
    'FULL vs WITHOUT_FORM_AND_MOMENTUM',
    'Full model vs model without form AND momentum',
    fullModel, withoutFormAndMomentum, n,
  ));

  // 4. Compute correlation between form and momentum contributions
  const formContributions: number[] = [];
  const momentumContributions: number[] = [];

  for (let i = 0; i < n; i++) {
    // Form contribution ≈ Full - WITHOUT_FORM
    const formDiff = Math.abs(fullModel[i].prob_home - withoutForm[i].prob_home);
    formContributions.push(formDiff);

    // Momentum contribution ≈ Full - WITHOUT_MOMENTUM
    const momDiff = Math.abs(fullModel[i].prob_home - withoutMomentum[i].prob_home);
    momentumContributions.push(momDiff);
  }

  const correlation = pearsonCorrelation(formContributions, momentumContributions);

  // 5. Check for double counting
  // If removing both has MORE effect than sum of individual removals,
  // that indicates overlap (double counting)
  let overlappingCount = 0;
  for (let i = 0; i < n; i++) {
    const bothRemoved = Math.abs(fullModel[i].prob_home - withoutFormAndMomentum[i].prob_home);
    const formRemoved = Math.abs(fullModel[i].prob_home - withoutForm[i].prob_home);
    const momRemoved = Math.abs(fullModel[i].prob_home - withoutMomentum[i].prob_home);
    // If both > sum of individuals, effects overlap
    if (bothRemoved > formRemoved + momRemoved + 0.001) {
      overlappingCount++;
    }
  }

  const overlapRate = n > 0 ? overlappingCount / n : 0;

  // Determine conclusion
  let conclusion: string;
  if (Math.abs(correlation) > 0.7) {
    conclusion = `HIGH DOUBLE COUNTING RISK: Form-Momentum correlation = ${correlation.toFixed(3)}. Momentum is derived from form, creating redundant information paths. Overlap rate: ${(overlapRate * 100).toFixed(1)}%. DO NOT modify until empirical validation.`;
  } else if (Math.abs(correlation) > 0.4) {
    conclusion = `MODERATE DOUBLE COUNTING RISK: Form-Momentum correlation = ${correlation.toFixed(3)}. Some overlap exists. Overlap rate: ${(overlapRate * 100).toFixed(1)}%. Measure on real data before deciding.`;
  } else {
    conclusion = `LOW DOUBLE COUNTING RISK: Form-Momentum correlation = ${correlation.toFixed(3)}. Effects appear mostly independent. Overlap rate: ${(overlapRate * 100).toFixed(1)}%.`;
  }

  return {
    form_momentum_correlation: correlation,
    full_model: fullModel,
    without_form: withoutForm,
    without_momentum: withoutMomentum,
    without_form_and_momentum: withoutFormAndMomentum,
    results,
    conclusion,
  };
}

// ═══════════════════════════════════════════════════════════════════
// AI ↔ ODDS DOUBLE COUNTING (Section 22)
// ═══════════════════════════════════════════════════════════════════

/**
 * Measure the double counting between AI and Odds.
 *
 * The AI model may receive odds as part of its prompt.
 * If so, the AI prediction already incorporates odds information.
 * Blending AI (35%) with odds-based Poisson (65%) would then
 * double-count the odds information.
 *
 * Measurement approach:
 *   1. Run Full model (includes AI blend + odds-based Poisson)
 *   2. Run WITHOUT_AI (pure Poisson, no AI blend)
 *   3. Run ODDS_ONLY (pure normalized odds, no Poisson adjustment)
 *   4. Run AI_ONLY if possible (pure AI prediction)
 *
 * If Full ≈ ODDS_ONLY → model adds nothing over odds (already concerning)
 * If WITHOUT_AI ≈ ODDS_ONLY → AI is the only source of non-odds information
 * If AI_ONLY ≈ ODDS_ONLY → AI is just reproducing odds → double counting
 */
export function measureAIOddsDoubleCounting(
  fullModel: PredictionResult[],
  withoutAi: PredictionResult[],
  oddsOnly: PredictionResult[],
  aiOnly: PredictionResult[] | null,
): AIOddsAudit {
  const n = Math.min(fullModel.length, withoutAi.length, oddsOnly.length);
  const results: DoubleCountingResult[] = [];

  // 1. Full vs WITHOUT_AI
  results.push(compareVariants(
    'FULL vs WITHOUT_AI',
    'Full model vs model without AI blend',
    fullModel, withoutAi, n,
  ));

  // 2. Full vs ODDS_ONLY
  results.push(compareVariants(
    'FULL vs ODDS_ONLY',
    'Full model vs pure odds (no Poisson, no AI)',
    fullModel, oddsOnly, n,
  ));

  // 3. WITHOUT_AI vs ODDS_ONLY
  results.push(compareVariants(
    'WITHOUT_AI vs ODDS_ONLY',
    'Poisson without AI vs pure odds',
    withoutAi, oddsOnly, n,
  ));

  // 4. If AI_ONLY available, compare with ODDS_ONLY
  if (aiOnly) {
    const nAi = Math.min(aiOnly.length, oddsOnly.length);
    results.push(compareVariants(
      'AI_ONLY vs ODDS_ONLY',
      'Pure AI prediction vs pure odds (if AI ≈ odds → double counting)',
      aiOnly, oddsOnly, nAi,
    ));
  }

  // Determine conclusion
  const fullVsOdds = results.find(r => r.variant === 'FULL vs ODDS_ONLY');
  const withoutAiVsOdds = results.find(r => r.variant === 'WITHOUT_AI vs ODDS_ONLY');

  let conclusion: string;
  if (fullVsOdds && fullVsOdds.avg_prob_diff < 0.03) {
    conclusion = `CRITICAL: Full model diverges only ${(fullVsOdds.avg_prob_diff * 100).toFixed(1)}% from raw odds. The model adds almost nothing beyond what odds already provide. AI blend may be reproducing odds information → double counting.`;
  } else if (withoutAiVsOdds && withoutAiVsOdds.avg_prob_diff < 0.03) {
    conclusion = `HIGH DOUBLE COUNTING RISK: Poisson without AI ≈ raw odds (${(withoutAiVsOdds.avg_prob_diff * 100).toFixed(1)}% diff). AI is the only source of divergence from odds. If AI integrates odds, it creates a double counting loop.`;
  } else if (fullVsOdds && fullVsOdds.avg_prob_diff < 0.10) {
    conclusion = `MODERATE DOUBLE COUNTING RISK: Full model diverges ${(fullVsOdds.avg_prob_diff * 100).toFixed(1)}% from odds. Some overlap between AI and odds likely exists. Measure on real data.`;
  } else {
    conclusion = `LOW DOUBLE COUNTING RISK: Full model diverges significantly from odds. AI and odds appear to provide independent information.`;
  }

  return {
    full_model: fullModel,
    without_ai: withoutAi,
    odds_only: oddsOnly,
    ai_only: aiOnly,
    results,
    conclusion,
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function compareVariants(
  variant: string,
  description: string,
  a: PredictionResult[],
  b: PredictionResult[],
  n: number,
): DoubleCountingResult {
  let agreementCount = 0;
  let totalProbDiff = 0;
  let maxProbDiff = 0;

  for (let i = 0; i < n; i++) {
    if (a[i].prediction === b[i].prediction) agreementCount++;
    const diff = Math.abs(a[i].prob_home - b[i].prob_home)
      + Math.abs(a[i].prob_draw - b[i].prob_draw)
      + Math.abs(a[i].prob_away - b[i].prob_away);
    totalProbDiff += diff / 2; // average across 3 probs
    maxProbDiff = Math.max(maxProbDiff, diff / 2);
  }

  const agreementRate = n > 0 ? agreementCount / n : 0;
  const divergenceRate = 1 - agreementRate;
  const avgProbDiff = n > 0 ? totalProbDiff / n : 0;

  // Compute correlation between the two probability vectors
  const aHome = a.slice(0, n).map(p => p.prob_home);
  const bHome = b.slice(0, n).map(p => p.prob_home);
  const correlation = pearsonCorrelation(aHome, bHome);

  return {
    variant,
    description,
    predictions_compared: n,
    correlation,
    agreement_rate: agreementRate,
    divergence_rate: divergenceRate,
    avg_prob_diff: avgProbDiff,
    max_prob_diff: maxProbDiff,
    significant: avgProbDiff > 0.05 || Math.abs(correlation) > 0.7,
  };
}

/**
 * Pearson correlation coefficient.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  const meanX = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanY = y.slice(0, n).reduce((s, v) => s + v, 0) / n;

  let sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  return denom > 0 ? sumXY / denom : 0;
}
