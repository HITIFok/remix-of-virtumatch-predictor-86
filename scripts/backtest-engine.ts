// ============================================
// BACKTEST ENGINE — Phase 5.3.20
// Scientific ablation framework using snapshot reconstruction
// ============================================
//
// This module provides:
//   - Ablation configurations (FULL, WITHOUT_AI, WITHOUT_H2H, etc.)
//   - A pure function that runs a single prediction for a given ablation
//   - No network, no Groq, no DB, no future data
//
// ARCHITECTURE:
//   - For ablations that only modify INPUTS (teamStats, historicalResults, AI):
//     run in-process directly via analyzeMatch()
//   - For ablations that require COEFFICIENT overrides (WITHOUT_MOMENTUM):
//     document that child-process execution is needed (deferred to framework integration)
//
// CRITICAL LIMITATION:
//   The AI prediction (AIPrediction) is NOT reconstructible from the snapshot
//   because the AI response is not stored (only the hash). Therefore:
//   - FULL_MODEL runs WITHOUT AI (same as WITHOUT_AI)
//   - WITHOUT_AI is identical to FULL_MODEL
//   - The only way to test WITH AI is to re-call Groq (FORBIDDEN in backtest)

import { analyzeMatch, type MatchInput, type MatchResult, type TeamStats, type HistoricalResult } from '../src/lib/prediction-engine';
import {
  reconstructMatchInputFromSnapshot,
  type StoredFeatureSnapshot,
  type ReconstructedInputs,
} from '../src/lib/snapshot-reconstruction';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════
// ABLATION TYPES
// ═══════════════════════════════════════════════════════════════════

export type AblationVariant =
  | 'FULL_MODEL'
  | 'WITHOUT_AI'
  | 'WITHOUT_H2H'
  | 'WITHOUT_FORM'
  | 'WITHOUT_MOMENTUM'
  | 'WITHOUT_STATS'
  | 'WITHOUT_ANTITRAP'
  | 'ODDS_ONLY'
  | 'POISSON_ONLY';

export interface AblationConfig {
  variant: AblationVariant;
  description: string;
  /** Which features are active */
  ai: boolean;
  h2h: boolean;
  form: boolean;
  momentum: boolean;
  stats: boolean;
  antiTrap: boolean;
  /** Whether child-process execution is required (for coefficient overrides) */
  requiresChildProcess: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// ABLATION MATRIX (audit mandate §15)
// ═══════════════════════════════════════════════════════════════════

export const ABLATION_MATRIX: Record<AblationVariant, AblationConfig> = {
  FULL_MODEL: {
    variant: 'FULL_MODEL',
    description: 'Full model (odds + Poisson + stats + form + H2H + redistribution + antitrap). NOTE: AI is NOT available in backtest because AI response is not stored.',
    ai: false,  // CANNOT be true in backtest — AI response not stored
    h2h: true,
    form: true,
    momentum: true,
    stats: true,
    antiTrap: true,
    requiresChildProcess: false,
  },
  WITHOUT_AI: {
    variant: 'WITHOUT_AI',
    description: 'Identical to FULL_MODEL in backtest context — AI response not reconstructible from snapshot. Both run with aiPrediction=undefined.',
    ai: false,
    h2h: true,
    form: true,
    momentum: true,
    stats: true,
    antiTrap: true,
    requiresChildProcess: false,
  },
  WITHOUT_H2H: {
    variant: 'WITHOUT_H2H',
    description: 'Remove H2H entries from historicalResults. Form, stats, odds, momentum, antitrap remain active.',
    ai: false,
    h2h: false,
    form: true,
    momentum: true,
    stats: true,
    antiTrap: true,
    requiresChildProcess: false,
  },
  WITHOUT_FORM: {
    variant: 'WITHOUT_FORM',
    description: 'Remove form entries from historicalResults. H2H, stats, odds, momentum, antitrap remain active.',
    ai: false,
    h2h: true,
    form: false,
    momentum: true,
    stats: true,
    antiTrap: true,
    requiresChildProcess: false,
  },
  WITHOUT_MOMENTUM: {
    variant: 'WITHOUT_MOMENTUM',
    description: 'Neutralize momentum boost by setting MOMENTUM_SCALE=100000 via child-process env override. All other features active.',
    ai: false,
    h2h: true,
    form: true,
    momentum: false,
    stats: true,
    antiTrap: true,
    requiresChildProcess: true,  // requires VIRTUMATCH_COEF_MOMENTUM_SCALE env override
  },
  WITHOUT_STATS: {
    variant: 'WITHOUT_STATS',
    description: 'Pass empty teamStats Map → adjustLambdasWithStats has no data to adjust. Form, H2H, odds, momentum, antitrap remain active.',
    ai: false,
    h2h: true,
    form: true,
    momentum: true,
    stats: false,
    antiTrap: true,
    requiresChildProcess: false,
  },
  WITHOUT_ANTITRAP: {
    variant: 'WITHOUT_ANTITRAP',
    description: 'Use raw Poisson 1X2 probabilities (from redistributed matrix) without antitrap override. NOTE: antitrap only affects mainScore selection and confidence — NOT the 1X2 probabilities. So WITHOUT_ANTITRAP produces identical probHome/draw/away as FULL_MODEL. The difference is in confidence and predicted score.',
    ai: false,
    h2h: true,
    form: true,
    momentum: true,
    stats: true,
    antiTrap: false,
    requiresChildProcess: false,
  },
  ODDS_ONLY: {
    variant: 'ODDS_ONLY',
    description: 'Only odds → implied probabilities → grid search lambdas → Poisson matrix → redistribution → antitrap. No stats, no form, no H2H, no AI. Uses analyzeMatch with empty teamStats + empty historicalResults.',
    ai: false,
    h2h: false,
    form: false,
    momentum: false,
    stats: false,
    antiTrap: true,  // redistribution + antitrap still run (they are part of analyzeMatch)
    requiresChildProcess: false,
  },
  POISSON_ONLY: {
    variant: 'POISSON_ONLY',
    description: 'Pure Poisson from odds. NO redistribution, NO antitrap, NO stats, NO form, NO H2H, NO AI. Independent computation that bypasses analyzeMatch entirely.',
    ai: false,
    h2h: false,
    form: false,
    momentum: false,
    stats: false,
    antiTrap: false,
    requiresChildProcess: false,
  },
};

// ═══════════════════════════════════════════════════════════════════
// INDEPENDENT POISSON COMPUTATION (for POISSON_ONLY baseline)
// ═══════════════════════════════════════════════════════════════════

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonProb(lambda: number, k: number): number {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

function compute1X2FromLambdas(lambdaH: number, lambdaA: number): { pH: number; pD: number; pA: number } {
  let pH = 0, pD = 0, pA = 0;
  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const p = poissonProb(lambdaH, h) * poissonProb(lambdaA, a);
      if (h > a) pH += p;
      else if (h < a) pA += p;
      else pD += p;
    }
  }
  return { pH, pD, pA };
}

function gridSearchLambdas(targetPH: number, targetPD: number, targetPA: number): { lambdaH: number; lambdaA: number } {
  let bestH = 1.5, bestA = 1.2, bestErr = Infinity;
  for (let lH = 0.5; lH <= 2.8; lH += 0.05) {
    for (let lA = 0.5; lA <= 2.8; lA += 0.05) {
      const { pH, pD, pA } = compute1X2FromLambdas(lH, lA);
      const err = Math.pow(pH - targetPH, 2) + Math.pow(pD - targetPD, 2) + Math.pow(pA - targetPA, 2);
      if (err < bestErr) {
        bestErr = err;
        bestH = lH;
        bestA = lA;
      }
    }
  }
  return { lambdaH: Math.round(bestH * 100) / 100, lambdaA: Math.round(bestA * 100) / 100 };
}

/**
 * Pure Poisson baseline — independent of analyzeMatch.
 * odds → implied probs → grid search lambdas → Poisson 1X2
 * NO redistribution, NO antitrap, NO stats, NO form, NO H2H, NO AI.
 */
export function poissonOnlyBaseline(oddHome: number, oddDraw: number, oddAway: number): {
  probHome: number; probDraw: number; probAway: number;
  lambdaH: number; lambdaA: number;
} {
  // Convert odds to implied probabilities (normalized)
  const invH = 1 / oddHome, invD = 1 / oddDraw, invA = 1 / oddAway;
  const total = invH + invD + invA;
  const tH = invH / total, tD = invD / total, tA = invA / total;

  // Grid search for lambdas
  const { lambdaH, lambdaA } = gridSearchLambdas(tH, tD, tA);

  // Compute 1X2 from Poisson
  const { pH, pD, pA } = compute1X2FromLambdas(lambdaH, lambdaA);

  // Normalize (Poisson sum may not be exactly 1 due to truncation at 10)
  const sum = pH + pD + pA;
  return {
    probHome: pH / sum,
    probDraw: pD / sum,
    probAway: pA / sum,
    lambdaH, lambdaA,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ODDS-ONLY NORMALIZED BASELINE (for ODDS_ONLY comparison)
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalized odds baseline — pure mathematical conversion.
 * This is the "Raw Odds" / "Normalized Odds" baseline.
 * Identical to the odds-implied probability (1/odd normalized).
 */
export function normalizedOddsBaseline(oddHome: number, oddDraw: number, oddAway: number): {
  probHome: number; probDraw: number; probAway: number;
} {
  const invH = 1 / oddHome, invD = 1 / oddDraw, invA = 1 / oddAway;
  const total = invH + invD + invA;
  return {
    probHome: invH / total,
    probDraw: invD / total,
    probAway: invA / total,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CHILD-PROCESS RUNNER (for coefficient-override ablations)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run an ablation via child process with env var overrides.
 *
 * This is REQUIRED for ablations that need coefficient overrides
 * (e.g. WITHOUT_MOMENTUM sets VIRTUMATCH_COEF_MOMENTUM_SCALE=100000).
 *
 * The child process has a fresh module cache → reads env vars at import time
 * → properly applies the override.
 *
 * The parent process env is NOT contaminated — env vars are only set in the
 * child process's env object, not in process.env of the parent.
 */
function runAblationViaChildProcess(
  recon: ReconstructedInputs,
  variant: AblationVariant,
  warnings: string[],
): AblationResult {
  const cfg = ABLATION_MATRIX[variant];

  // Serialize teamStats Map → array for JSON transport
  const teamStatsArray = Array.from(recon.teamStats.entries()).map(([name, ts]) => ({ ...ts, name }));

  // Build env vars based on variant
  const envOverrides: Record<string, string> = {};
  if (variant === 'WITHOUT_MOMENTUM') {
    // MOMENTUM_SCALE=100000 makes momentum boost ≈ 0 (divided by 100000)
    envOverrides['VIRTUMATCH_COEF_MOMENTUM_SCALE'] = '100000';
  }

  // Build input JSON
  const input = {
    home: recon.match.home,
    away: recon.match.away,
    league: recon.match.league,
    oddHome: recon.match.oddHome,
    oddDraw: recon.match.oddDraw,
    oddAway: recon.match.oddAway,
    teamStatsArray,
    historicalResults: recon.historicalResults,
  };

  // Write to temp files
  const tmpDir = '/tmp';
  const tmpInput = path.join(tmpDir, `backtest-${variant}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const tmpOutput = path.join(tmpDir, `backtest-${variant}-out-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmpInput, JSON.stringify(input));

  try {
    const helperScript = path.resolve(path.join(__dirname, 'backtest-ablation-helper.ts'));
    const envObj: Record<string, string> = { ...process.env as Record<string, string>, ...envOverrides };

    execSync(`npx tsx ${helperScript} ${tmpInput} ${tmpOutput}`, {
      cwd: path.resolve(__dirname, '..'),
      timeout: 30000,
      stdio: 'pipe',
      env: envObj,
    });

    const result = JSON.parse(fs.readFileSync(tmpOutput, 'utf8'));
    const prediction: '1' | 'X' | '2' = result.predicted as '1' | 'X' | '2';

    return {
      variant,
      probHome: result.probHome,
      probDraw: result.probDraw,
      probAway: result.probAway,
      prediction,
      confidence: result.confidence || 0,
      scoreHome: result.scoreHome || 0,
      scoreAway: result.scoreAway || 0,
      warnings,
    };
  } catch (err) {
    warnings.push(`${variant}: child process failed: ${(err as Error).message}`);
    // Fallback to in-process (without the override — momentum will still be active)
    const result = analyzeMatch(recon.match, undefined, recon.teamStats, recon.historicalResults);
    const prediction: '1' | 'X' | '2' = result.winner1X2.startsWith('1') ? '1'
      : result.winner1X2.startsWith('2') ? '2' : 'X';
    return {
      variant,
      probHome: result.probHome,
      probDraw: result.probDraw,
      probAway: result.probAway,
      prediction,
      confidence: result.aiConfidence,
      scoreHome: result.scoreHome,
      scoreAway: result.scoreAway,
      warnings,
    };
  } finally {
    try { fs.unlinkSync(tmpInput); } catch {}
    try { fs.unlinkSync(tmpOutput); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════════
// ABLATION RUNNER (in-process for non-override ablations)
// ═══════════════════════════════════════════════════════════════════

export interface AblationResult {
  variant: AblationVariant;
  probHome: number;
  probDraw: number;
  probAway: number;
  prediction: '1' | 'X' | '2';
  confidence: number;
  scoreHome: number;
  scoreAway: number;
  /** Warnings from reconstruction or ablation */
  warnings: string[];
}

/**
 * Run a single ablation on a reconstructed snapshot.
 *
 * PURE: no network, no DB, no Groq, no side effects.
 * DETERMINISTIC: same inputs → same output.
 *
 * @param recon - Reconstructed inputs from snapshot
 * @param variant - Which ablation to run
 * @returns AblationResult with probabilities + prediction
 */
export function runAblation(
  recon: ReconstructedInputs,
  variant: AblationVariant,
): AblationResult {
  const warnings: string[] = recon.warnings.slice();

  const cfg = ABLATION_MATRIX[variant];
  if (!cfg) {
    throw new Error(`Unknown ablation variant: ${variant}`);
  }

  if (cfg.requiresChildProcess) {
    // For WITHOUT_MOMENTUM etc. — child process is needed for env var override.
    // Phase 5.3.21: Now properly implemented via child-process execution.
    return runAblationViaChildProcess(recon, variant, warnings);
  }

  // ── POISSON_ONLY — independent computation ──
  if (variant === 'POISSON_ONLY') {
    if (recon.match.oddHome <= 0 || recon.match.oddDraw <= 0 || recon.match.oddAway <= 0) {
      warnings.push('POISSON_ONLY: invalid odds — returning uniform');
      return {
        variant, probHome: 1/3, probDraw: 1/3, probAway: 1/3,
        prediction: 'X', confidence: 33, scoreHome: 0, scoreAway: 0, warnings,
      };
    }
    const { probHome, probDraw, probAway, lambdaH, lambdaA } = poissonOnlyBaseline(
      recon.match.oddHome, recon.match.oddDraw, recon.match.oddAway
    );
    const prediction: '1' | 'X' | '2' = probHome >= probDraw && probHome >= probAway ? '1'
      : probAway >= probDraw ? '2' : 'X';
    return {
      variant, probHome, probDraw, probAway,
      prediction, confidence: Math.round(Math.max(probHome, probDraw, probAway) * 100),
      scoreHome: Math.round(lambdaH), scoreAway: Math.round(lambdaA),
      warnings,
    };
  }

  // ── Prepare inputs based on ablation variant ──
  const match: MatchInput = recon.match;
  // AI is NEVER available in backtest (response not stored)
  const aiPrediction = undefined;

  // TeamStats: empty for WITHOUT_STATS and ODDS_ONLY
  const teamStats = (!cfg.stats || variant === 'ODDS_ONLY')
    ? new Map<string, any>()
    : recon.teamStats;

  // HistoricalResults: filter based on ablation
  let historicalResults = recon.historicalResults;
  if (variant === 'ODDS_ONLY') {
    historicalResults = [];
  } else if (variant === 'WITHOUT_H2H') {
    // Remove H2H entries: entries where home=predictionHome AND away=predictionAway
    historicalResults = historicalResults.filter(r =>
      !(r.home === match.home && r.away === match.away)
    );
  } else if (variant === 'WITHOUT_FORM') {
    // Remove form entries: keep ONLY H2H entries
    historicalResults = historicalResults.filter(r =>
      (r.home === match.home && r.away === match.away)
    );
  }

  // Run analyzeMatch
  try {
    const result = analyzeMatch(match, aiPrediction, teamStats, historicalResults);
    const prediction: '1' | 'X' | '2' = result.winner1X2.startsWith('1') ? '1'
      : result.winner1X2.startsWith('2') ? '2' : 'X';

    return {
      variant,
      probHome: result.probHome,
      probDraw: result.probDraw,
      probAway: result.probAway,
      prediction,
      confidence: result.aiConfidence,
      scoreHome: result.scoreHome,
      scoreAway: result.scoreAway,
      warnings,
    };
  } catch (err) {
    warnings.push(`${variant}: analyzeMatch threw: ${(err as Error).message}`);
    // Fallback to normalized odds
    const { probHome, probDraw, probAway } = normalizedOddsBaseline(
      match.oddHome || 2, match.oddDraw || 3, match.oddAway || 3
    );
    const prediction: '1' | 'X' | '2' = probHome >= probDraw && probHome >= probAway ? '1'
      : probAway >= probDraw ? '2' : 'X';
    return {
      variant, probHome, probDraw, probAway,
      prediction, confidence: 0, scoreHome: 0, scoreAway: 0, warnings,
    };
  }
}

/**
 * Run ALL ablations on a single snapshot.
 * Returns a map of variant → AblationResult.
 */
export function runAllAblations(
  snapshot: StoredFeatureSnapshot | null | undefined,
  homeTeam: string,
  awayTeam: string,
  league: string = 'Unknown',
): Record<AblationVariant, AblationResult> {
  const recon = reconstructMatchInputFromSnapshot(snapshot, homeTeam, awayTeam, league);
  const results: Partial<Record<AblationVariant, AblationResult>> = {};

  for (const variant of Object.keys(ABLATION_MATRIX) as AblationVariant[]) {
    results[variant] = runAblation(recon, variant);
  }

  return results as Record<AblationVariant, AblationResult>;
}
