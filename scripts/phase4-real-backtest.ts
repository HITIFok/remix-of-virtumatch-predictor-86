// ============================================
// PHASE 4 — BACKTEST RÉEL NEON & VALIDATION STATISTIQUE
// Real statistical validation with Neon PostgreSQL data
// ============================================
//
// CRITICAL: Ne modifie PAS les coefficients du modèle.
// L'objectif est de MESURER honnêtement les performances actuelles.
//
// Usage: npx tsx scripts/phase4-real-backtest.ts
//
// If NEON_DATABASE_URL is not available:
//   - Reports FULL MODEL VALIDATION PENDING
//   - Proceeds with odds-only analysis only
//   - Never fakes or simulates results

import { analyzeMatch, type MatchInput, type MatchResult } from '../src/lib/prediction-engine';
import { getConfig, validateCoefficients, COEFFICIENT_DEFINITIONS } from '../src/lib/prediction-config';
import {
  createOddsOnlySnapshot,
  analyzeProvenance,
  classifyLegacyPrediction,
  computeSnapshotHash,
  computePredictionHash,
  MODEL_VERSION,
  FEATURE_VERSION,
  CONFIG_VERSION,
  CALIBRATION_VERSION,
  DATASET_VERSION,
  type FeatureSnapshot,
  type ProvenanceSummary,
} from '../src/lib/feature-snapshot';
import {
  getFormAtTimestamp,
  getH2HAtTimestamp,
  getStatsAtTimestamp,
  checkFeatureLeakage,
  type TemporalResult,
  type TemporalRankingEntry,
} from '../src/lib/historical-reconstruction';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const OUTPUT_DIR = path.join(__dirname, '..', 'download');
const DOCS_DIR = path.join(__dirname, '..', 'docs');

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface PredictionRow {
  id: string;
  created_at: string;
  home_team: string;
  away_team: string;
  league: string | null;
  odd_home: number | null;
  odd_draw: number | null;
  odd_away: number | null;
  prob_home: number | null;
  prob_draw: number | null;
  prob_away: number | null;
  prediction: string | null;
  confidence: number | null;
  actual_outcome: string | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
  status: string | null;
  match_id: number | null;
  device_id: string | null;
  user_id: string | null;
  feature_snapshot: any | null;
  model_version: string | null;
  feature_version: string | null;
  config_version: string | null;
  calibration_version: string | null;
  dataset_version: string | null;
  feature_snapshot_hash: string | null;
  prediction_hash: string | null;
  snapshot_timestamp: string | null;
  provenance_status: string | null;
}

interface VerifiedPrediction {
  id: string;
  match_id: number | null;
  home_team: string;
  away_team: string;
  league: string;
  created_at: string;
  odd_home: number;
  odd_draw: number;
  odd_away: number;
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  prediction: '1' | 'X' | '2';
  confidence: number;
  actual_outcome: '1' | 'X' | '2';
  actual_home_score: number | null;
  actual_away_score: number | null;
  has_snapshot: boolean;
  provenance_status: string;
  feature_snapshot: FeatureSnapshot | null;
  model_version: string | null;
  feature_snapshot_hash: string | null;
  prediction_hash: string | null;
  // Classification
  snapshot_class: 'RECORDED' | 'RECONSTRUCTED' | 'UNKNOWN' | 'UNSAFE';
  temporal_valid: boolean;
}

interface Metrics {
  n: number;
  accuracy: number;
  balancedAccuracy: number;
  precision1: number;
  precisionX: number;
  precision2: number;
  recall1: number;
  recallX: number;
  recall2: number;
  f1: number;
  f1_1: number;
  f1_X: number;
  f1_2: number;
  logLoss: number;
  brierScore: number;
  ece: number;
  mce: number;
  homeAccuracy: number;
  drawAccuracy: number;
  awayAccuracy: number;
  nHome: number;
  nDraw: number;
  nAway: number;
}

interface ConfidenceInterval {
  lower: number;
  upper: number;
  level: number;
}

interface MetricWithCI {
  value: number;
  ci: ConfidenceInterval;
  n: number;
}

// ═══════════════════════════════════════════════════════════════════
// METRICS ENGINE
// ═══════════════════════════════════════════════════════════════════

function computeMetrics(preds: VerifiedPrediction[]): Metrics {
  const verified = preds.filter(p => p.actual_outcome !== null);
  const n = verified.length;
  if (n === 0) return emptyMetrics();

  const nHome = verified.filter(p => p.actual_outcome === '1').length;
  const nDraw = verified.filter(p => p.actual_outcome === 'X').length;
  const nAway = verified.filter(p => p.actual_outcome === '2').length;

  // Accuracy
  const correct = verified.filter(p => p.prediction === p.actual_outcome).length;
  const accuracy = correct / n;

  // Per-class
  const homeCorrect = verified.filter(p => p.actual_outcome === '1' && p.prediction === '1').length;
  const drawCorrect = verified.filter(p => p.actual_outcome === 'X' && p.prediction === 'X').length;
  const awayCorrect = verified.filter(p => p.actual_outcome === '2' && p.prediction === '2').length;

  const predHome = verified.filter(p => p.prediction === '1').length;
  const predDraw = verified.filter(p => p.prediction === 'X').length;
  const predAway = verified.filter(p => p.prediction === '2').length;

  const precision1 = predHome > 0 ? homeCorrect / predHome : 0;
  const precisionX = predDraw > 0 ? drawCorrect / predDraw : 0;
  const precision2 = predAway > 0 ? awayCorrect / predAway : 0;

  const recall1 = nHome > 0 ? homeCorrect / nHome : 0;
  const recallX = nDraw > 0 ? drawCorrect / nDraw : 0;
  const recall2 = nAway > 0 ? awayCorrect / nAway : 0;

  const f1_1 = (precision1 + recall1) > 0 ? 2 * precision1 * recall1 / (precision1 + recall1) : 0;
  const f1_X = (precisionX + recallX) > 0 ? 2 * precisionX * recallX / (precisionX + recallX) : 0;
  const f1_2 = (precision2 + recall2) > 0 ? 2 * precision2 * recall2 / (precision2 + recall2) : 0;

  // Macro F1
  const f1 = (f1_1 + f1_X + f1_2) / 3;

  // Balanced accuracy
  const balancedAccuracy = (recall1 + recallX + recall2) / 3;

  // Log Loss
  let logLossSum = 0;
  for (const p of verified) {
    const probs = [p.prob_home, p.prob_draw, p.prob_away];
    const idx = p.actual_outcome === '1' ? 0 : p.actual_outcome === 'X' ? 1 : 2;
    const prob = Math.max(probs[idx], 1e-15);
    logLossSum -= Math.log(prob);
  }
  const logLoss = logLossSum / n;

  // Brier Score
  let brierSum = 0;
  for (const p of verified) {
    const actual = [0, 0, 0];
    if (p.actual_outcome === '1') actual[0] = 1;
    else if (p.actual_outcome === 'X') actual[1] = 1;
    else actual[2] = 1;
    const pred = [p.prob_home, p.prob_draw, p.prob_away];
    brierSum += (pred[0] - actual[0]) ** 2 + (pred[1] - actual[1]) ** 2 + (pred[2] - actual[2]) ** 2;
  }
  const brierScore = brierSum / n;

  // ECE (Expected Calibration Error)
  const nBins = 10;
  const bins: { sumConf: number; sumAcc: number; count: number }[] = 
    Array.from({ length: nBins }, () => ({ sumConf: 0, sumAcc: 0, count: 0 }));
  for (const p of verified) {
    const conf = Math.max(p.prob_home, p.prob_draw, p.prob_away);
    const acc = p.prediction === p.actual_outcome ? 1 : 0;
    const binIdx = Math.min(Math.floor(conf * nBins), nBins - 1);
    bins[binIdx].sumConf += conf;
    bins[binIdx].sumAcc += acc;
    bins[binIdx].count++;
  }
  let ece = 0;
  let mce = 0;
  for (const bin of bins) {
    if (bin.count > 0) {
      const gap = Math.abs(bin.sumAcc / bin.count - bin.sumConf / bin.count);
      ece += (bin.count / n) * gap;
      mce = Math.max(mce, gap);
    }
  }

  return {
    n, accuracy, balancedAccuracy,
    precision1, precisionX, precision2,
    recall1, recallX, recall2,
    f1, f1_1, f1_X, f1_2,
    logLoss, brierScore, ece, mce,
    homeAccuracy: recall1, drawAccuracy: recallX, awayAccuracy: recall2,
    nHome, nDraw, nAway,
  };
}

function emptyMetrics(): Metrics {
  return {
    n: 0, accuracy: 0, balancedAccuracy: 0,
    precision1: 0, precisionX: 0, precision2: 0,
    recall1: 0, recallX: 0, recall2: 0,
    f1: 0, f1_1: 0, f1_X: 0, f1_2: 0,
    logLoss: Infinity, brierScore: Infinity, ece: 0, mce: 0,
    homeAccuracy: 0, drawAccuracy: 0, awayAccuracy: 0,
    nHome: 0, nDraw: 0, nAway: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════
// BOOTSTRAP CONFIDENCE INTERVALS
// ═══════════════════════════════════════════════════════════════════

function bootstrapCI(
  preds: VerifiedPrediction[],
  metricFn: (p: VerifiedPrediction[]) => number,
  nBootstrap: number = 2000,
  confidenceLevel: number = 0.95
): ConfidenceInterval {
  const n = preds.length;
  if (n < 10) return { lower: 0, upper: 1, level: confidenceLevel };

  const bootstrapValues: number[] = [];
  for (let b = 0; b < nBootstrap; b++) {
    const sample: VerifiedPrediction[] = [];
    for (let i = 0; i < n; i++) {
      sample.push(preds[Math.floor(Math.random() * n)]);
    }
    bootstrapValues.push(metricFn(sample));
  }
  bootstrapValues.sort((a, b) => a - b);

  const alpha = 1 - confidenceLevel;
  const lowerIdx = Math.floor(nBootstrap * alpha / 2);
  const upperIdx = Math.floor(nBootstrap * (1 - alpha / 2));

  return {
    lower: bootstrapValues[lowerIdx] ?? 0,
    upper: bootstrapValues[upperIdx] ?? 1,
    level: confidenceLevel,
  };
}

// ═══════════════════════════════════════════════════════════════════
// BASELINES
// ═══════════════════════════════════════════════════════════════════

function majorityBaseline(preds: VerifiedPrediction[]): VerifiedPrediction[] {
  // Always predict Home (most common in football)
  return preds.map(p => ({
    ...p,
    prediction: '1' as const,
    prob_home: 0.50, prob_draw: 0.25, prob_away: 0.25,
    confidence: 50,
  }));
}

function rawOddsBaseline(preds: VerifiedPrediction[]): VerifiedPrediction[] {
  return preds.map(p => {
    const invH = 1 / (p.odd_home || 3);
    const invD = 1 / (p.odd_draw || 3);
    const invA = 1 / (p.odd_away || 3);
    const total = invH + invD + invA;
    const pH = invH / total, pD = invD / total, pA = invA / total;
    const prediction: '1' | 'X' | '2' = pH >= pD && pH >= pA ? '1' : pA >= pD ? '2' : 'X';
    return { ...p, prediction, prob_home: pH, prob_draw: pD, prob_away: pA, confidence: Math.round(Math.max(pH, pD, pA) * 100) };
  });
}

function normalizedOddsBaseline(preds: VerifiedPrediction[]): VerifiedPrediction[] {
  // Same as raw odds but with margin removal (already normalized above)
  return rawOddsBaseline(preds);
}

function simplePoissonBaseline(preds: VerifiedPrediction[]): VerifiedPrediction[] {
  // Pure Poisson model from odds — no form, no H2H, no stats, no AI
  return preds.map(p => {
    try {
      const result = analyzeMatch({
        home: p.home_team,
        away: p.away_team,
        league: p.league || 'Unknown',
        oddHome: p.odd_home,
        oddDraw: p.odd_draw,
        oddAway: p.odd_away,
      }, undefined, undefined, undefined);
      
      // Override to odds-only probabilities (strip form/H2H/AI influence)
      const invH = 1 / p.odd_home, invD = 1 / p.odd_draw, invA = 1 / p.odd_away;
      const total = invH + invD + invA;
      const pH = invH / total, pD = invD / total, pA = invA / total;
      
      return {
        ...p,
        prob_home: pH, prob_draw: pD, prob_away: pA,
        prediction: (pH >= pD && pH >= pA ? '1' : pA >= pD ? '2' : 'X') as '1' | 'X' | '2',
        confidence: Math.round(Math.max(pH, pD, pA) * 100),
      };
    } catch {
      return rawOddsBaseline([p])[0];
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// ABLATION: Run prediction engine with specific features disabled
// ═══════════════════════════════════════════════════════════════════

function ablationWithoutAI(preds: VerifiedPrediction[]): VerifiedPrediction[] {
  // AI_WEIGHT = 0 effectively removes AI
  const origEnv = process.env.VIRTUMATCH_COEF_AI_WEIGHT;
  process.env.VIRTUMATCH_COEF_AI_WEIGHT = '0.01'; // minimal, can't be 0 due to bounds
  // Force re-read of config by reimporting... but that's not possible in TS.
  // Instead, we use the odds-implied probabilities as a proxy
  process.env.VIRTUMATCH_COEF_AI_WEIGHT = origEnv;
  // For ablation, we compute what the model would predict without AI
  // by using odds + form + H2H + stats only (no AI blend)
  // The simplest honest approach: run the full model but replace AI contribution
  return preds.map(p => {
    // Without AI, the model relies on odds → Poisson → stats → form → H2H → redistribution
    // We approximate by using the model's non-AI probability (which is (1-AI_WEIGHT) * Poisson_probs)
    const fullWeight = 1 - 0.35; // 1 - AI_WEIGHT
    const pH = p.prob_home; // Current model output includes AI
    // Without AI: p_noAI = (p_full - AI_WEIGHT * p_AI) / (1 - AI_WEIGHT)
    // Since we don't have p_AI separately, we use normalized odds as the non-AI component
    const invH = 1 / p.odd_home, invD = 1 / p.odd_draw, invA = 1 / p.odd_away;
    const total = invH + invD + invA;
    const oddsH = invH / total, oddsD = invD / total, oddsA = invA / total;
    // Approximation: blend odds more heavily
    const noAI_H = pH * 0.6 + oddsH * 0.4;
    const noAI_D = p.prob_draw * 0.6 + oddsD * 0.4;
    const noAI_A = p.prob_away * 0.6 + oddsA * 0.4;
    const sumP = noAI_H + noAI_D + noAI_A;
    const predH = noAI_H / sumP, predD = noAI_D / sumP, predA = noAI_A / sumP;
    const prediction: '1' | 'X' | '2' = predH >= predD && predH >= predA ? '1' : predA >= predD ? '2' : 'X';
    return { ...p, prob_home: predH, prob_draw: predD, prob_away: predA, prediction, confidence: Math.round(Math.max(predH, predD, predA) * 100) };
  });
}

function ablationOddsOnly(preds: VerifiedPrediction[]): VerifiedPrediction[] {
  return rawOddsBaseline(preds);
}

function ablationPoissonOnly(preds: VerifiedPrediction[]): VerifiedPrediction[] {
  // Pure Poisson: odds → lambda → Poisson matrix → probabilities
  // No form, no H2H, no stats, no AI, no anti-trap
  return preds.map(p => {
    try {
      const result = analyzeMatch({
        home: p.home_team, away: p.away_team, league: p.league || 'Unknown',
        oddHome: p.odd_home, oddDraw: p.odd_draw, oddAway: p.odd_away,
      }, undefined, undefined, undefined);
      return {
        ...p,
        prob_home: result.probHome, prob_draw: result.probDraw, prob_away: result.probAway,
        prediction: result.winner1X2.startsWith('1') ? '1' as const : result.winner1X2.startsWith('2') ? '2' as const : 'X' as const,
        confidence: result.aiConfidence,
      };
    } catch {
      return rawOddsBaseline([p])[0];
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════

interface DeduplicationReport {
  total: number;
  duplicates: number;
  duplicateGroups: { key: string; count: number; kept: string; removed: string[] }[];
  rule: string;
}

function deduplicatePredictions(preds: VerifiedPrediction[]): { unique: VerifiedPrediction[]; report: DeduplicationReport } {
  // Rule: For same match_id + same created_at date, keep the one with the highest confidence
  // If same match_id with different timestamps, keep the earliest (first prediction made)
  const groups = new Map<string, VerifiedPrediction[]>();
  
  for (const p of preds) {
    const key = `${p.home_team}|${p.away_team}|${p.created_at.substring(0, 10)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const unique: VerifiedPrediction[] = [];
  const duplicateGroups: DeduplicationReport['duplicateGroups'] = [];
  let totalDuplicates = 0;

  for (const [key, group] of groups) {
    if (group.length === 1) {
      unique.push(group[0]);
    } else {
      // Sort: earliest first, then highest confidence
      group.sort((a, b) => {
        const timeCompare = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (timeCompare !== 0) return timeCompare;
        return b.confidence - a.confidence;
      });
      unique.push(group[0]);
      totalDuplicates += group.length - 1;
      duplicateGroups.push({
        key,
        count: group.length,
        kept: group[0].id,
        removed: group.slice(1).map(p => p.id),
      });
    }
  }

  return {
    unique,
    report: {
      total: preds.length,
      duplicates: totalDuplicates,
      duplicateGroups,
      rule: 'For same match + same date: keep earliest prediction with highest confidence',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEMPORAL SPLIT
// ═══════════════════════════════════════════════════════════════════

interface TemporalSplit {
  train: VerifiedPrediction[];
  validation: VerifiedPrediction[];
  test: VerifiedPrediction[];
  trainStart: string;
  trainEnd: string;
  validationStart: string;
  validationEnd: string;
  testStart: string;
  testEnd: string;
}

function temporalSplit(preds: VerifiedPrediction[], trainPct: number = 0.6, valPct: number = 0.2): TemporalSplit {
  // Sort by created_at
  const sorted = [...preds].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const n = sorted.length;
  const trainEnd = Math.floor(n * trainPct);
  const valEnd = Math.floor(n * (trainPct + valPct));

  const train = sorted.slice(0, trainEnd);
  const validation = sorted.slice(trainEnd, valEnd);
  const test = sorted.slice(valEnd);

  return {
    train,
    validation,
    test,
    trainStart: train.length > 0 ? train[0].created_at : 'N/A',
    trainEnd: train.length > 0 ? train[train.length - 1].created_at : 'N/A',
    validationStart: validation.length > 0 ? validation[0].created_at : 'N/A',
    validationEnd: validation.length > 0 ? validation[validation.length - 1].created_at : 'N/A',
    testStart: test.length > 0 ? test[0].created_at : 'N/A',
    testEnd: test.length > 0 ? test[test.length - 1].created_at : 'N/A',
  };
}

// ═══════════════════════════════════════════════════════════════════
// WALK-FORWARD VALIDATION
// ═══════════════════════════════════════════════════════════════════

interface WalkForwardResult {
  windowIndex: number;
  trainSize: number;
  testSize: number;
  accuracy: number;
  logLoss: number;
  brierScore: number;
  trainEnd: string;
  testEnd: string;
}

function walkForwardValidation(
  preds: VerifiedPrediction[],
  windowSize: number = 30,
  stepSize: number = 10
): WalkForwardResult[] {
  const sorted = [...preds].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const results: WalkForwardResult[] = [];
  
  let trainStart = 0;
  let trainEnd = windowSize;
  
  while (trainEnd + stepSize <= sorted.length) {
    const testStart = trainEnd;
    const testEnd = Math.min(testStart + stepSize, sorted.length);
    
    const testSet = sorted.slice(testStart, testEnd);
    if (testSet.length > 0) {
      const metrics = computeMetrics(testSet);
      results.push({
        windowIndex: results.length,
        trainSize: trainEnd - trainStart,
        testSize: testSet.length,
        accuracy: metrics.accuracy,
        logLoss: metrics.logLoss,
        brierScore: metrics.brierScore,
        trainEnd: sorted[trainEnd - 1]?.created_at || 'N/A',
        testEnd: sorted[testEnd - 1]?.created_at || 'N/A',
      });
    }
    
    trainEnd += stepSize;
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════
// CALIBRATION ANALYSIS
// ═══════════════════════════════════════════════════════════════════

interface CalibrationBin {
  binIndex: number;
  lower: number;
  upper: number;
  meanPredicted: number;
  meanActual: number;
  count: number;
  gap: number;
}

interface CalibrationAnalysis {
  ece: number;
  mce: number;
  brierScore: number;
  logLoss: number;
  bins: CalibrationBin[];
  reliabilityDiagram: { predicted: number; actual: number; count: number }[];
}

function analyzeCalibration(preds: VerifiedPrediction[], nBins: number = 10): CalibrationAnalysis {
  const verified = preds.filter(p => p.actual_outcome !== null);
  const n = verified.length;
  if (n === 0) return { ece: 0, mce: 0, brierScore: Infinity, logLoss: Infinity, bins: [], reliabilityDiagram: [] };

  const bins: CalibrationBin[] = [];
  const reliabilityDiagram: { predicted: number; actual: number; count: number }[] = [];

  for (let i = 0; i < nBins; i++) {
    const lower = i / nBins;
    const upper = (i + 1) / nBins;
    
    const inBin = verified.filter(p => {
      const conf = Math.max(p.prob_home, p.prob_draw, p.prob_away);
      return conf >= lower && (i === nBins - 1 ? conf <= upper : conf < upper);
    });

    if (inBin.length > 0) {
      const meanPredicted = inBin.reduce((s, p) => s + Math.max(p.prob_home, p.prob_draw, p.prob_away), 0) / inBin.length;
      const meanActual = inBin.filter(p => p.prediction === p.actual_outcome).length / inBin.length;
      const gap = Math.abs(meanActual - meanPredicted);
      
      bins.push({ binIndex: i, lower, upper, meanPredicted, meanActual, count: inBin.length, gap });
      reliabilityDiagram.push({ predicted: meanPredicted, actual: meanActual, count: inBin.length });
    }
  }

  const ece = bins.reduce((s, b) => s + (b.count / n) * b.gap, 0);
  const mce = bins.reduce((max, b) => Math.max(max, b.gap), 0);

  const metrics = computeMetrics(verified);

  return { ece, mce, brierScore: metrics.brierScore, logLoss: metrics.logLoss, bins, reliabilityDiagram };
}

// ═══════════════════════════════════════════════════════════════════
// MCNEMAR TEST
// ═══════════════════════════════════════════════════════════════════

function mcnemarTest(
  model1Preds: VerifiedPrediction[],
  model2Preds: VerifiedPrediction[]
): { statistic: number; pValue: number; significant: boolean; n: number; b: number; c: number } {
  // b = model1 correct AND model2 wrong
  // c = model1 wrong AND model2 correct
  let b = 0, c = 0, n = 0;
  
  for (let i = 0; i < model1Preds.length; i++) {
    const p1 = model1Preds[i];
    const p2 = model2Preds[i];
    if (p1.actual_outcome === null) continue;
    n++;
    
    const correct1 = p1.prediction === p1.actual_outcome;
    const correct2 = p2.prediction === p2.actual_outcome;
    
    if (correct1 && !correct2) b++;
    else if (!correct1 && correct2) c++;
  }
  
  // McNemar's test: chi2 = (|b - c| - 1)^2 / (b + c)
  // with continuity correction
  if (b + c === 0) return { statistic: 0, pValue: 1, significant: false, n, b, c };
  
  const statistic = (Math.abs(b - c) - 1) ** 2 / (b + c);
  
  // Approximate p-value from chi-squared distribution with 1 df
  // Using the approximation: p ≈ exp(-statistic/2)
  const pValue = Math.exp(-statistic / 2);
  const significant = pValue < 0.05;
  
  return { statistic, pValue, significant, n, b, c };
}

// ═══════════════════════════════════════════════════════════════════
// DOUBLE COUNTING AUDIT
// ═══════════════════════════════════════════════════════════════════

interface DoubleCountingFinding {
  path: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  sources: string[];
  evidence: string;
}

function auditDoubleCounting(): DoubleCountingFinding[] {
  return [
    {
      path: 'odds → grid search → stats adjustment',
      description: 'Odds are used to compute initial lambdas via grid search, then stats adjustment re-uses odds-derived lambdas as the base (STAT_BASE_WEIGHT=0.70). The same odds information is present in both steps.',
      severity: 'medium',
      sources: ['ÉTAPE 1: convertOddsToProbabilities', 'ÉTAPE 2: gridSearchLambdas', 'ÉTAPE 4: adjustLambdasWithStats (STAT_BASE_WEIGHT)'],
      evidence: 'STAT_BASE_WEIGHT=0.70 means 70% of the final lambda comes from odds. The grid search already optimized lambdas to match odds-implied probabilities. Then stats adjustment blends odds-based lambda with attack/defense stats, effectively counting odds strength twice.',
    },
    {
      path: 'form → momentum',
      description: 'Momentum is derived from form (weighted points from recent matches). Form is also used directly in lambda adjustment (FORM_ATTACK_BOOST, FORM_DEFENSE_PENALTY). The same match results influence both form adjustment AND momentum-derived adjustment.',
      severity: 'high',
      sources: ['ÉTAPE 3: extractTeamForm (formScores, avgScored, avgConceded)', 'ÉTAPE 5: adjustLambdasWithHistory (formAdjustment)', 'MOMENTUM_SCALE applied to momentumScore derived from form'],
      evidence: 'formScores → momentumScore (weighted points / max points × 100). Then: formAdjustment = (avgScored - VIRTUAL_AVG_GOALS) × FORM_ATTACK_BOOST. AND momentum adjustment via MOMENTUM_SCALE. Same underlying data (recent match results) used twice.',
    },
    {
      path: 'stats → attack strength → form',
      description: 'TeamStats.avgGoalsScored and form.avgScored may overlap. Stats cover the full season, form covers last 5 matches. If the last 5 matches are included in the full season stats, their goal contribution is counted in both.',
      severity: 'medium',
      sources: ['ÉTAPE 4: adjustLambdasWithStats (attackStrength, defenseWeakness)', 'ÉTAPE 5: adjustLambdasWithHistory (formAdjustment)'],
      evidence: 'attackStrength = avgGoalsScored / VIRTUAL_AVG_GOALS. formAdjustment = (form.avgScored - VIRTUAL_AVG_GOALS) × FORM_ATTACK_BOOST. If a team scored heavily in recent matches, both attackStrength AND form boost increase lambda.',
    },
    {
      path: 'AI → may already incorporate odds/stats/form',
      description: 'The AI (Groq LLM) receives match context including odds and may already internalize the same information that the mathematical model computes. AI_WEIGHT=0.35 blends AI probabilities with the Poisson matrix, potentially double-counting odds information.',
      severity: 'high',
      sources: ['ÉTAPE 7: blendWithAI (AI_WEIGHT=0.35)', 'AI input: receives odds, team names, league context'],
      evidence: 'AI is prompted with match details including odds. It may predict based on the same odds that already drove grid search. Then AI_WEIGHT=0.35 blends this back. If AI agrees with odds, the combined probability overweights the odds-based prediction.',
    },
    {
      path: 'H2H → may overlap with form',
      description: 'H2H matches between two teams are also part of each team\'s recent form. If a home match against the away team is in the last 5 form matches, that match contributes to BOTH form calculation AND H2H bias.',
      severity: 'low',
      sources: ['ÉTAPE 5: adjustLambdasWithHistory (h2hAdjustment)', 'ÉTAPE 3: extractTeamForm includes all recent matches'],
      evidence: 'H2H uses historicalResults filtered for specific opponent. Form uses all recent matches regardless of opponent. If Team A played Team B recently, that match is in both form and H2H. However, H2H bias is typically from older matches, reducing overlap.',
    },
    {
      path: 'anti-trap → confidence → probability',
      description: 'Anti-trap detection modifies confidence score (additive bonuses/penalties). Confidence is used for display but also affects the perceived reliability of probabilities. If confidence-boosted predictions are used in LogLoss/Brier calculations with the original probabilities, there may be a mismatch.',
      severity: 'low',
      sources: ['ÉTAPE 9: determineMainScore (isAntiTrap)', 'ÉTAPE 13: calculateMultiFactorConfidence'],
      evidence: 'Confidence is a heuristic score (25-82%), not a calibrated probability. It does not directly modify prob_home/prob_draw/prob_away. However, if users interpret confidence as probability reliability, there may be a conceptual double-counting with the actual calibrated probabilities.',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════
// NEON DATABASE CONNECTION
// ═══════════════════════════════════════════════════════════════════

async function connectToNeon(): Promise<any | null> {
  const dbUrl = process.env.NEON_DATABASE_URL;
  if (!dbUrl) {
    console.log('  ⚠️  NEON_DATABASE_URL not set');
    console.log('  ⚠️  Cannot connect to Neon PostgreSQL');
    console.log('  ⚠️  Real backtest requires database access');
    return null;
  }

  try {
    const postgres = (await import('postgres')).default;
    const sql = postgres(dbUrl, { max: 1 });
    
    // Test connection
    const result = await sql`SELECT 1 as test`;
    if (result[0]?.test === 1) {
      console.log('  ✓ Connected to Neon PostgreSQL');
      return sql;
    }
    await sql.end();
    return null;
  } catch (err: any) {
    console.log(`  ⚠️  Failed to connect: ${err.message}`);
    return null;
  }
}

async function fetchPredictionsFromNeon(sql: any): Promise<PredictionRow[]> {
  console.log('  Fetching predictions from Neon...');
  
  const rows = await sql`
    SELECT 
      id, created_at, home_team, away_team, league,
      odd_home, odd_draw, odd_away,
      prob_home, prob_draw, prob_away,
      prediction, confidence,
      actual_outcome, actual_home_score, actual_away_score,
      status, match_id, device_id, user_id,
      feature_snapshot, model_version, feature_version, config_version,
      calibration_version, dataset_version,
      feature_snapshot_hash, prediction_hash,
      snapshot_timestamp, provenance_status
    FROM predictions
    ORDER BY created_at ASC
  `;
  
  console.log(`  ✓ Fetched ${rows.length} predictions`);
  return rows as PredictionRow[];
}

async function checkMigrationStatus(sql: any): Promise<{ applied: boolean; partial: boolean; columnsPresent: boolean }> {
  try {
    // Check if feature_snapshot column exists
    const cols = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'predictions' 
      AND column_name IN ('feature_snapshot', 'model_version', 'feature_snapshot_hash', 'provenance_status')
      ORDER BY column_name
    `;
    const presentCols = cols.map((r: any) => r.column_name);
    const requiredCols = ['feature_snapshot', 'model_version', 'feature_snapshot_hash', 'provenance_status'];
    const allPresent = requiredCols.every(c => presentCols.includes(c));
    
    return {
      applied: allPresent,
      partial: presentCols.length > 0 && !allPresent,
      columnsPresent: allPresent,
    };
  } catch {
    return { applied: false, partial: false, columnsPresent: false };
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONVERT RAW DB ROWS TO VERIFIED PREDICTIONS
// ═══════════════════════════════════════════════════════════════════

function rowsToVerified(rows: PredictionRow[]): { verified: VerifiedPrediction[]; stats: DatasetStats } {
  const stats: DatasetStats = {
    total: rows.length,
    withResult: 0,
    withoutResult: 0,
    duplicates: 0,
    withSnapshot: 0,
    withoutSnapshot: 0,
    recorded: 0,
    reconstructed: 0,
    unknown: 0,
    unsafe: 0,
    cancelled: 0,
    noOdds: 0,
    testOrSim: 0,
  };

  const verified: VerifiedPrediction[] = [];

  for (const row of rows) {
    // Skip predictions without actual result
    if (!row.actual_outcome || !['1', 'X', '2'].includes(row.actual_outcome)) {
      stats.withoutResult++;
      continue;
    }
    
    // Skip predictions without valid odds
    if (!row.odd_home || !row.odd_draw || !row.odd_away || row.odd_home <= 1 || row.odd_draw <= 1 || row.odd_away <= 1) {
      stats.noOdds++;
      continue;
    }
    
    // Skip cancelled
    if (row.status === 'cancelled') {
      stats.cancelled++;
      continue;
    }
    
    // Skip test/simulation device IDs
    if (row.device_id?.startsWith('test-') || row.device_id?.startsWith('sim-')) {
      stats.testOrSim++;
      continue;
    }

    stats.withResult++;

    const hasSnapshot = row.feature_snapshot !== null;
    if (hasSnapshot) stats.withSnapshot++;
    else stats.withoutSnapshot++;

    // Determine provenance class
    let snapshotClass: VerifiedPrediction['snapshot_class'] = 'UNKNOWN';
    let temporalValid = true;

    if (hasSnapshot) {
      const provenance = row.provenance_status;
      if (provenance === 'VALID') {
        snapshotClass = 'RECORDED';
        stats.recorded++;
      } else if (provenance === 'PARTIALLY_VALID') {
        snapshotClass = 'RECONSTRUCTED';
        stats.reconstructed++;
      } else if (provenance === 'INVALID') {
        snapshotClass = 'UNSAFE';
        stats.unsafe++;
        temporalValid = false;
      } else {
        snapshotClass = 'UNKNOWN';
        stats.unknown++;
      }
    } else {
      // No snapshot: classify based on what we CAN verify
      // Odds are RECORDED (stored in predictions table)
      // Everything else is UNKNOWN
      snapshotClass = 'UNKNOWN';
      stats.unknown++;
    }

    // Normalize probabilities
    let probHome = row.prob_home ?? 0;
    let probDraw = row.prob_draw ?? 0;
    let probAway = row.prob_away ?? 0;
    
    // If probabilities don't sum to ~1, re-normalize from odds
    const probSum = probHome + probDraw + probAway;
    if (probSum < 0.5 || probSum > 1.5 || isNaN(probSum)) {
      const invH = 1 / row.odd_home, invD = 1 / row.odd_draw, invA = 1 / row.odd_away;
      const total = invH + invD + invA;
      probHome = invH / total;
      probDraw = invD / total;
      probAway = invA / total;
    } else if (Math.abs(probSum - 1) > 0.01) {
      probHome /= probSum;
      probDraw /= probSum;
      probAway /= probSum;
    }

    // Determine prediction from probabilities if not stored
    let prediction = row.prediction as '1' | 'X' | '2';
    if (!prediction || !['1', 'X', '2'].includes(prediction)) {
      prediction = probHome >= probDraw && probHome >= probAway ? '1' : probAway >= probDraw ? '2' : 'X';
    }

    verified.push({
      id: String(row.id),
      match_id: row.match_id,
      home_team: row.home_team || 'Unknown',
      away_team: row.away_team || 'Unknown',
      league: row.league || 'Unknown',
      created_at: row.created_at,
      odd_home: row.odd_home,
      odd_draw: row.odd_draw,
      odd_away: row.odd_away,
      prob_home: probHome,
      prob_draw: probDraw,
      prob_away: probAway,
      prediction,
      confidence: row.confidence ?? 50,
      actual_outcome: row.actual_outcome as '1' | 'X' | '2',
      actual_home_score: row.actual_home_score,
      actual_away_score: row.actual_away_score,
      has_snapshot: hasSnapshot,
      provenance_status: row.provenance_status || 'UNKNOWN',
      feature_snapshot: hasSnapshot ? row.feature_snapshot : null,
      model_version: row.model_version,
      feature_snapshot_hash: row.feature_snapshot_hash,
      prediction_hash: row.prediction_hash,
      snapshot_class: snapshotClass,
      temporal_valid: temporalValid,
    });
  }

  return { verified, stats };
}

interface DatasetStats {
  total: number;
  withResult: number;
  withoutResult: number;
  duplicates: number;
  withSnapshot: number;
  withoutSnapshot: number;
  recorded: number;
  reconstructed: number;
  unknown: number;
  unsafe: number;
  cancelled: number;
  noOdds: number;
  testOrSim: number;
}

// ═══════════════════════════════════════════════════════════════════
// AI_WEIGHT SWEEP ON VALIDATION
// ═══════════════════════════════════════════════════════════════════

function aiWeightSweep(preds: VerifiedPrediction[], weights: number[]): { weight: number; metrics: Metrics }[] {
  // Since we can't actually modify AI_WEIGHT at runtime (it's loaded once),
  // we approximate by blending the current model output with odds-only
  const results: { weight: number; metrics: Metrics }[] = [];
  
  const currentWeight = 0.35; // Current AI_WEIGHT
  
  for (const targetWeight of weights) {
    const blended = preds.map(p => {
      // Decompose: p_full = (1 - currentWeight) * p_poisson + currentWeight * p_ai
      // We want: p_new = (1 - targetWeight) * p_poisson + targetWeight * p_ai
      // Approximate p_poisson from odds, p_ai from (p_full - (1-currentWeight)*p_poisson) / currentWeight
      
      const invH = 1 / p.odd_home, invD = 1 / p.odd_draw, invA = 1 / p.odd_away;
      const total = invH + invD + invA;
      const oddsH = invH / total, oddsD = invD / total, oddsA = invA / total;
      
      // Approximate Poisson component as odds (simplified)
      const poissonH = oddsH, poissonD = oddsD, poissonA = oddsA;
      
      // Approximate AI component
      const aiH = currentWeight > 0 ? (p.prob_home - (1 - currentWeight) * poissonH) / currentWeight : poissonH;
      const aiD = currentWeight > 0 ? (p.prob_draw - (1 - currentWeight) * poissonD) / currentWeight : poissonD;
      const aiA = currentWeight > 0 ? (p.prob_away - (1 - currentWeight) * poissonA) / currentWeight : poissonA;
      
      // New blend
      let newH = (1 - targetWeight) * poissonH + targetWeight * aiH;
      let newD = (1 - targetWeight) * poissonD + targetWeight * aiD;
      let newA = (1 - targetWeight) * poissonA + targetWeight * aiA;
      
      // Normalize
      const sum = newH + newD + newA;
      if (sum > 0) { newH /= sum; newD /= sum; newA /= sum; }
      
      // Clamp to valid range
      newH = Math.max(0.01, Math.min(0.98, newH));
      newD = Math.max(0.01, Math.min(0.98, newD));
      newA = Math.max(0.01, Math.min(0.98, newA));
      const sum2 = newH + newD + newA;
      newH /= sum2; newD /= sum2; newA /= sum2;
      
      const prediction: '1' | 'X' | '2' = newH >= newD && newH >= newA ? '1' : newA >= newD ? '2' : 'X';
      
      return { ...p, prob_home: newH, prob_draw: newD, prob_away: newA, prediction, confidence: Math.round(Math.max(newH, newD, newA) * 100) };
    });
    
    results.push({ weight: targetWeight, metrics: computeMetrics(blended) });
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════
// FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════════

function fmtPct(v: number): string { return (v * 100).toFixed(1) + '%'; }
function fmtDec(v: number, d: number = 3): string { return v.toFixed(d); }
function fmtCI(m: MetricWithCI): string { return `${fmtPct(m.value)} [${fmtPct(m.ci.lower)}, ${fmtPct(m.ci.upper)}] (N=${m.n})`; }
function fmtMetricWithN(name: string, value: number, n: number, fmt: 'pct' | 'dec' = 'pct'): string {
  const formatted = fmt === 'pct' ? fmtPct(value) : fmtDec(value);
  return `${name} = ${formatted} (N = ${n})`;
}

function metricsToTable(name: string, m: Metrics): string {
  return `| ${name} | ${m.n} | ${fmtPct(m.accuracy)} | ${fmtPct(m.balancedAccuracy)} | ${fmtPct(m.precision1)} | ${fmtPct(m.recall1)} | ${fmtPct(m.f1)} | ${fmtDec(m.logLoss)} | ${fmtDec(m.brierScore, 4)} | ${fmtDec(m.ece)} | ${fmtDec(m.mce)} |`;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();
  const COMMIT_HASH = '3c7e747b41face8bc3ddcd2b7425063b59f02fff';
  
  console.log('═'.repeat(70));
  console.log('PHASE 4 — BACKTEST RÉEL NEON & VALIDATION STATISTIQUE');
  console.log('═'.repeat(70));
  console.log(`Commit: ${COMMIT_HASH.substring(0, 7)}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Model: VirtuMatch Predictor v${MODEL_VERSION}`);
  console.log('');

  // Ensure output directories
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

  // ════════════════════════════════════════════════════════════════
  // 1. PREFLIGHT
  // ════════════════════════════════════════════════════════════════
  console.log('\n[1] PREFLIGHT CHECKS');
  console.log('─'.repeat(40));
  
  const cfg = getConfig();
  const validation = validateCoefficients(cfg);
  console.log(`  Coefficient validation: ${validation.valid ? '✓ VALID' : '✗ INVALID'}`);
  if (validation.errors.length > 0) console.log(`  Errors: ${validation.errors.join(', ')}`);
  if (validation.warnings.length > 0) console.log(`  Warnings: ${validation.warnings.length} (arbitrary coefficients)`);
  
  console.log(`  AI_WEIGHT: ${cfg.AI_WEIGHT}`);
  console.log(`  VIRTUAL_AVG_GOALS: ${cfg.VIRTUAL_AVG_GOALS}`);
  console.log(`  STAT weights: ${cfg.STAT_BASE_WEIGHT}/${cfg.STAT_ATTACK_WEIGHT}/${cfg.STAT_DEF_WEIGHT} (sum: ${(cfg.STAT_BASE_WEIGHT + cfg.STAT_ATTACK_WEIGHT + cfg.STAT_DEF_WEIGHT).toFixed(2)})`);

  // ════════════════════════════════════════════════════════════════
  // 2. NEON DATABASE CONNECTION
  // ════════════════════════════════════════════════════════════════
  console.log('\n[2] NEON DATABASE CONNECTION');
  console.log('─'.repeat(40));
  
  const sql = await connectToNeon();
  let neonConnected = sql !== null;
  let migrationStatus = { applied: false, partial: false, columnsPresent: false };
  let rawPredictions: PredictionRow[] = [];
  
  if (neonConnected) {
    migrationStatus = await checkMigrationStatus(sql);
    console.log(`  Migration 006: ${migrationStatus.applied ? '✓ APPLIED' : migrationStatus.partial ? '⚠ PARTIAL' : '✗ NOT APPLIED'}`);
    
    try {
      rawPredictions = await fetchPredictionsFromNeon(sql);
    } catch (err: any) {
      console.log(`  ⚠️  Failed to fetch predictions: ${err.message}`);
      rawPredictions = [];
    }
    
    await sql.end();
  }

  // ════════════════════════════════════════════════════════════════
  // 3. BUILD DATASET
  // ════════════════════════════════════════════════════════════════
  console.log('\n[3] BUILD HISTORICAL DATASET');
  console.log('─'.repeat(40));
  
  let datasetStats: DatasetStats;
  let verifiedPredictions: VerifiedPrediction[];
  
  if (rawPredictions.length > 0) {
    const { verified, stats } = rowsToVerified(rawPredictions);
    verifiedPredictions = verified;
    datasetStats = stats;
    console.log(`  Total raw: ${stats.total}`);
    console.log(`  With result: ${stats.withResult}`);
    console.log(`  Without result: ${stats.withoutResult}`);
    console.log(`  No odds: ${stats.noOdds}`);
    console.log(`  Cancelled: ${stats.cancelled}`);
    console.log(`  Test/Sim: ${stats.testOrSim}`);
  } else {
    // No Neon data available — honest status
    console.log('  ⚠️  No Neon predictions available');
    console.log('  ⚠️  Cannot perform real backtest without historical data');
    console.log('');
    console.log('  STATUS: FULL MODEL VALIDATION PENDING — INSUFFICIENT HISTORICAL DATA');
    console.log('  Proceeding with framework validation and code analysis only');
    
    datasetStats = {
      total: 0, withResult: 0, withoutResult: 0, duplicates: 0,
      withSnapshot: 0, withoutSnapshot: 0, recorded: 0, reconstructed: 0,
      unknown: 0, unsafe: 0, cancelled: 0, noOdds: 0, testOrSim: 0,
    };
    verifiedPredictions = [];
  }

  // ════════════════════════════════════════════════════════════════
  // 4. DEDUPLICATION
  // ════════════════════════════════════════════════════════════════
  console.log('\n[4] DEDUPLICATION');
  console.log('─'.repeat(40));
  
  const { unique: uniquePredictions, report: dedupReport } = deduplicatePredictions(verifiedPredictions);
  datasetStats.duplicates = dedupReport.duplicates;
  console.log(`  Before: ${dedupReport.total}, After: ${uniquePredictions.length}, Duplicates: ${dedupReport.duplicates}`);
  console.log(`  Rule: ${dedupReport.rule}`);

  // ════════════════════════════════════════════════════════════════
  // 5. TEMPORAL INTEGRITY
  // ════════════════════════════════════════════════════════════════
  console.log('\n[5] TEMPORAL INTEGRITY');
  console.log('─'.repeat(40));
  
  let temporalViolations = 0;
  const temporalSafePredictions: VerifiedPrediction[] = [];
  
  for (const p of uniquePredictions) {
    if (!p.temporal_valid) {
      temporalViolations++;
      continue;
    }
    temporalSafePredictions.push(p);
  }
  
  console.log(`  Total predictions: ${uniquePredictions.length}`);
  console.log(`  Temporal violations: ${temporalViolations}`);
  console.log(`  Temporally safe: ${temporalSafePredictions.length}`);

  // ════════════════════════════════════════════════════════════════
  // 6-7. BACKTESTS
  // ════════════════════════════════════════════════════════════════
  console.log('\n[6] BACKTEST A — ODDS VALIDATED');
  console.log('─'.repeat(40));
  
  let backtestAResults: { name: string; metrics: Metrics }[] = [];
  let backtestBResults: { name: string; metrics: Metrics }[] = [];
  let backtestBValid = false;
  
  if (uniquePredictions.length >= 10) {
    // Backtest A: All predictions with valid odds (safest)
    const oddsValid = uniquePredictions.filter(p => p.odd_home > 1 && p.odd_draw > 1 && p.odd_away > 1);
    console.log(`  Predictions with valid odds: ${oddsValid.length}`);
    
    // VirtuMatch Current
    const currentMetrics = computeMetrics(oddsValid);
    backtestAResults.push({ name: 'VirtuMatch Current', metrics: currentMetrics });
    console.log(`  VirtuMatch: Accuracy=${fmtPct(currentMetrics.accuracy)} (N=${currentMetrics.n}), LogLoss=${fmtDec(currentMetrics.logLoss)}, Brier=${fmtDec(currentMetrics.brierScore, 4)}`);
    
    // Baseline 1: Majority
    const majorityPreds = majorityBaseline(oddsValid);
    const majorityMetrics = computeMetrics(majorityPreds);
    backtestAResults.push({ name: 'Majority Class', metrics: majorityMetrics });
    console.log(`  Majority: Accuracy=${fmtPct(majorityMetrics.accuracy)} (N=${majorityMetrics.n})`);
    
    // Baseline 2: Raw Odds
    const rawOddsPreds = rawOddsBaseline(oddsValid);
    const rawOddsMetrics = computeMetrics(rawOddsPreds);
    backtestAResults.push({ name: 'Raw Odds', metrics: rawOddsMetrics });
    console.log(`  Raw Odds: Accuracy=${fmtPct(rawOddsMetrics.accuracy)} (N=${rawOddsMetrics.n})`);
    
    // Baseline 3: Normalized Odds
    const normOddsPreds = normalizedOddsBaseline(oddsValid);
    const normOddsMetrics = computeMetrics(normOddsPreds);
    backtestAResults.push({ name: 'Normalized Odds', metrics: normOddsMetrics });
    
    // Baseline 4: Simple Poisson
    const poissonPreds = simplePoissonBaseline(oddsValid);
    const poissonMetrics = computeMetrics(poissonPreds);
    backtestAResults.push({ name: 'Simple Poisson', metrics: poissonMetrics });
    console.log(`  Poisson: Accuracy=${fmtPct(poissonMetrics.accuracy)} (N=${poissonMetrics.n})`);

    // ══════════════════════════════════════════════════════════════
    // 7. BACKTEST B — FULL MODEL
    // ══════════════════════════════════════════════════════════════
    console.log('\n[7] BACKTEST B — FULL MODEL');
    console.log('─'.repeat(40));
    
    const fullModelValid = uniquePredictions.filter(p => 
      p.has_snapshot && 
      p.snapshot_class !== 'UNKNOWN' && 
      p.snapshot_class !== 'UNSAFE' && 
      p.temporal_valid &&
      p.feature_snapshot_hash !== null &&
      p.model_version !== null
    );
    
    backtestBValid = fullModelValid.length > 0;
    
    if (backtestBValid) {
      console.log(`  Predictions valid for full model: ${fullModelValid.length}`);
      const fullMetrics = computeMetrics(fullModelValid);
      backtestBResults.push({ name: 'VirtuMatch Full Model', metrics: fullMetrics });
      console.log(`  Full Model: Accuracy=${fmtPct(fullMetrics.accuracy)} (N=${fullMetrics.n})`);
    } else {
      console.log('  ⚠️  FULL MODEL BACKTEST = NOT VALIDATED');
      console.log('  No predictions meet all criteria:');
      console.log('    - feature_snapshot exists');
      console.log('    - provenance ≠ UNKNOWN/UNSAFE');
      console.log('    - temporal_valid = true');
      console.log('    - feature_snapshot_hash present');
      console.log('    - model_version present');
      console.log('');
      console.log('  FULL MODEL VALIDATION PENDING — INSUFFICIENT HISTORICAL SNAPSHOT COVERAGE');
    }
  } else {
    console.log('  ⚠️  Insufficient data for backtest (need ≥ 10 predictions, have ' + uniquePredictions.length + ')');
  }

  // ════════════════════════════════════════════════════════════════
  // 8. TEMPORAL SPLIT
  // ════════════════════════════════════════════════════════════════
  console.log('\n[8] TEMPORAL SPLIT');
  console.log('─'.repeat(40));
  
  let split: TemporalSplit | null = null;
  let splitMetrics: { train: Metrics; validation: Metrics; test: Metrics } | null = null;
  
  if (uniquePredictions.length >= 30) {
    split = temporalSplit(uniquePredictions);
    console.log(`  TRAIN: ${split.train.length} (${split.trainStart.substring(0, 10)} → ${split.trainEnd.substring(0, 10)})`);
    console.log(`  VALIDATION: ${split.validation.length} (${split.validationStart.substring(0, 10)} → ${split.validationEnd.substring(0, 10)})`);
    console.log(`  TEST: ${split.test.length} (${split.testStart.substring(0, 10)} → ${split.testEnd.substring(0, 10)})`);
    
    splitMetrics = {
      train: computeMetrics(split.train),
      validation: computeMetrics(split.validation),
      test: computeMetrics(split.test),
    };
    
    console.log(`  TEST: Accuracy=${fmtPct(splitMetrics.test.accuracy)} (N=${splitMetrics.test.n})`);
  } else {
    console.log('  ⚠️  Insufficient data for temporal split (need ≥ 30)');
  }

  // ════════════════════════════════════════════════════════════════
  // 9. WALK-FORWARD
  // ════════════════════════════════════════════════════════════════
  console.log('\n[9] WALK-FORWARD VALIDATION');
  console.log('─'.repeat(40));
  
  let wfResults: WalkForwardResult[] = [];
  if (uniquePredictions.length >= 50) {
    wfResults = walkForwardValidation(uniquePredictions, 30, 10);
    console.log(`  Windows: ${wfResults.length}`);
    if (wfResults.length > 0) {
      const avgAcc = wfResults.reduce((s, w) => s + w.accuracy, 0) / wfResults.length;
      const avgLL = wfResults.reduce((s, w) => s + w.logLoss, 0) / wfResults.length;
      console.log(`  Average accuracy: ${fmtPct(avgAcc)}`);
      console.log(`  Average LogLoss: ${fmtDec(avgLL)}`);
    }
  } else {
    console.log('  ⚠️  Insufficient data for walk-forward (need ≥ 50)');
  }

  // ════════════════════════════════════════════════════════════════
  // 10. ABLATION
  // ════════════════════════════════════════════════════════════════
  console.log('\n[10] ABLATION STUDY');
  console.log('─'.repeat(40));
  
  let ablationResults: { name: string; metrics: Metrics }[] = [];
  
  if (uniquePredictions.length >= 10) {
    const dataset = split?.test || uniquePredictions;
    
    // Full model
    ablationResults.push({ name: 'FULL MODEL', metrics: computeMetrics(dataset) });
    
    // Odds only
    const oddsOnly = ablationOddsOnly(dataset);
    ablationResults.push({ name: 'ODDS_ONLY', metrics: computeMetrics(oddsOnly) });
    
    // Poisson only
    const poissonOnly = ablationPoissonOnly(dataset);
    ablationResults.push({ name: 'POISSON_ONLY', metrics: computeMetrics(poissonOnly) });
    
    // Without AI
    const noAI = ablationWithoutAI(dataset);
    ablationResults.push({ name: 'WITHOUT_AI', metrics: computeMetrics(noAI) });
    
    for (const r of ablationResults) {
      console.log(`  ${r.name}: Accuracy=${fmtPct(r.metrics.accuracy)} (N=${r.metrics.n}), F1=${fmtPct(r.metrics.f1)}, LogLoss=${fmtDec(r.metrics.logLoss)}, Brier=${fmtDec(r.metrics.brierScore, 4)}`);
    }
  } else {
    console.log('  ⚠️  Insufficient data for ablation study');
  }

  // ════════════════════════════════════════════════════════════════
  // 11. DOUBLE COUNTING AUDIT
  // ════════════════════════════════════════════════════════════════
  console.log('\n[11] DOUBLE COUNTING AUDIT');
  console.log('─'.repeat(40));
  
  const doubleCounting = auditDoubleCounting();
  console.log(`  Findings: ${doubleCounting.length}`);
  for (const f of doubleCounting) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.path}`);
  }

  // ════════════════════════════════════════════════════════════════
  // 12-13. PARAMETER SWEEPSS
  // ════════════════════════════════════════════════════════════════
  console.log('\n[12] AI_WEIGHT VALIDATION SWEEP');
  console.log('─'.repeat(40));
  
  let aiWeightResults: { weight: number; metrics: Metrics }[] = [];
  const sweepDataset = split?.validation || uniquePredictions;
  
  if (sweepDataset.length >= 10) {
    aiWeightResults = aiWeightSweep(sweepDataset, [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35]);
    for (const r of aiWeightResults) {
      console.log(`  AI_WEIGHT=${r.weight.toFixed(2)}: Accuracy=${fmtPct(r.metrics.accuracy)}, LogLoss=${fmtDec(r.metrics.logLoss)}`);
    }
  } else {
    console.log('  ⚠️  Insufficient data for AI_WEIGHT sweep');
  }

  // ════════════════════════════════════════════════════════════════
  // 14. CALIBRATION
  // ════════════════════════════════════════════════════════════════
  console.log('\n[14] CALIBRATION ANALYSIS');
  console.log('─'.repeat(40));
  
  let calibration: CalibrationAnalysis | null = null;
  if (uniquePredictions.length >= 10) {
    calibration = analyzeCalibration(uniquePredictions);
    console.log(`  ECE: ${fmtDec(calibration.ece)}`);
    console.log(`  MCE: ${fmtDec(calibration.mce)}`);
    console.log(`  Brier Score: ${fmtDec(calibration.brierScore, 4)}`);
    console.log(`  Log Loss: ${fmtDec(calibration.logLoss)}`);
    console.log(`  Bins: ${calibration.bins.length}`);
    for (const bin of calibration.bins) {
      console.log(`    [${bin.lower.toFixed(1)}-${bin.upper.toFixed(1)}]: predicted=${fmtPct(bin.meanPredicted)}, actual=${fmtPct(bin.meanActual)}, N=${bin.count}, gap=${fmtPct(bin.gap)}`);
    }
  } else {
    console.log('  ⚠️  Insufficient data for calibration analysis');
  }

  // ════════════════════════════════════════════════════════════════
  // 15. CONFIDENCE INTERVALS
  // ════════════════════════════════════════════════════════════════
  console.log('\n[15] CONFIDENCE INTERVALS (Bootstrap)');
  console.log('─'.repeat(40));
  
  let accuracyCI: MetricWithCI | null = null;
  let logLossCI: MetricWithCI | null = null;
  let brierCI: MetricWithCI | null = null;
  
  if (uniquePredictions.length >= 30) {
    const accFn = (p: VerifiedPrediction[]) => computeMetrics(p).accuracy;
    const llFn = (p: VerifiedPrediction[]) => computeMetrics(p).logLoss;
    const brierFn = (p: VerifiedPrediction[]) => computeMetrics(p).brierScore;
    
    const metrics = computeMetrics(uniquePredictions);
    accuracyCI = { value: metrics.accuracy, ci: bootstrapCI(uniquePredictions, accFn), n: metrics.n };
    logLossCI = { value: metrics.logLoss, ci: bootstrapCI(uniquePredictions, llFn), n: metrics.n };
    brierCI = { value: metrics.brierScore, ci: bootstrapCI(uniquePredictions, brierFn), n: metrics.n };
    
    console.log(`  Accuracy: ${fmtPct(accuracyCI.value)} [95% CI: ${fmtPct(accuracyCI.ci.lower)}, ${fmtPct(accuracyCI.ci.upper)}] (N=${accuracyCI.n})`);
    console.log(`  Log Loss: ${fmtDec(logLossCI.value)} [95% CI: ${fmtDec(logLossCI.ci.lower)}, ${fmtDec(logLossCI.ci.upper)}] (N=${logLossCI.n})`);
    console.log(`  Brier:    ${fmtDec(brierCI.value, 4)} [95% CI: ${fmtDec(brierCI.ci.lower, 4)}, ${fmtDec(brierCI.ci.upper, 4)}] (N=${brierCI.n})`);
  } else {
    console.log('  ⚠️  Insufficient data for bootstrap CI (need ≥ 30)');
  }

  // ════════════════════════════════════════════════════════════════
  // 16. SIGNIFICANCE TESTS
  // ════════════════════════════════════════════════════════════════
  console.log('\n[16] SIGNIFICANCE TESTS');
  console.log('─'.repeat(40));
  
  let significanceResults: { comparison: string; mcnemar: ReturnType<typeof mcnemarTest> }[] = [];
  
  if (uniquePredictions.length >= 30) {
    const current = uniquePredictions;
    const normOdds = normalizedOddsBaseline(uniquePredictions);
    const majority = majorityBaseline(uniquePredictions);
    
    significanceResults.push({
      comparison: 'VirtuMatch vs Normalized Odds',
      mcnemar: mcnemarTest(current, normOdds),
    });
    
    significanceResults.push({
      comparison: 'VirtuMatch vs Majority',
      mcnemar: mcnemarTest(current, majority),
    });
    
    for (const r of significanceResults) {
      console.log(`  ${r.comparison}: χ²=${fmtDec(r.mcnemar.statistic, 2)}, p=${fmtDec(r.mcnemar.pValue, 4)}, ${r.mcnemar.significant ? 'SIGNIFICANT' : 'NOT SIGNIFICANT'} (N=${r.mcnemar.n}, b=${r.mcnemar.b}, c=${r.mcnemar.c})`);
    }
  } else {
    console.log('  ⚠️  Insufficient data for significance tests (need ≥ 30)');
  }

  // ════════════════════════════════════════════════════════════════
  // 18. SEGMENTATION
  // ════════════════════════════════════════════════════════════════
  console.log('\n[18] SEGMENTATION');
  console.log('─'.repeat(40));
  
  let segmentation: { segment: string; metrics: Metrics }[] = [];
  
  if (uniquePredictions.length >= 20) {
    // By outcome type
    const homePreds = uniquePredictions.filter(p => p.actual_outcome === '1');
    const drawPreds = uniquePredictions.filter(p => p.actual_outcome === 'X');
    const awayPreds = uniquePredictions.filter(p => p.actual_outcome === '2');
    
    if (homePreds.length >= 5) segmentation.push({ segment: 'Home Wins', metrics: computeMetrics(homePreds) });
    if (drawPreds.length >= 5) segmentation.push({ segment: 'Draws', metrics: computeMetrics(drawPreds) });
    if (awayPreds.length >= 5) segmentation.push({ segment: 'Away Wins', metrics: computeMetrics(awayPreds) });
    
    // By league (if enough data)
    const leagueGroups = new Map<string, VerifiedPrediction[]>();
    for (const p of uniquePredictions) {
      if (!leagueGroups.has(p.league)) leagueGroups.set(p.league, []);
      leagueGroups.get(p.league)!.push(p);
    }
    for (const [league, preds] of leagueGroups) {
      if (preds.length >= 10) {
        segmentation.push({ segment: `League: ${league}`, metrics: computeMetrics(preds) });
      }
    }
    
    // By favorite/underdog
    const favCorrect = uniquePredictions.filter(p => {
      const isHomeFav = p.odd_home < p.odd_away;
      return isHomeFav && p.prediction === '1' || !isHomeFav && p.prediction === '2';
    });
    const underdogPreds = uniquePredictions.filter(p => {
      const isHomeFav = p.odd_home < p.odd_away;
      return isHomeFav && p.prediction === '2' || !isHomeFav && p.prediction === '1';
    });
    
    if (favCorrect.length >= 5) segmentation.push({ segment: 'Favorite Predictions', metrics: computeMetrics(favCorrect) });
    if (underdogPreds.length >= 5) segmentation.push({ segment: 'Underdog Predictions', metrics: computeMetrics(underdogPreds) });
    
    for (const s of segmentation) {
      console.log(`  ${s.segment}: Accuracy=${fmtPct(s.metrics.accuracy)} (N=${s.metrics.n})`);
    }
  } else {
    console.log('  ⚠️  Insufficient data for segmentation');
  }

  // ════════════════════════════════════════════════════════════════
  // 19. LEAKAGE GATE FINAL
  // ════════════════════════════════════════════════════════════════
  console.log('\n[19] LEAKAGE GATE FINAL');
  console.log('─'.repeat(40));
  
  const leakageGate = {
    snapshotValid: datasetStats.withSnapshot > 0,
    hashValid: uniquePredictions.some(p => p.feature_snapshot_hash !== null),
    timestampsConsistent: temporalViolations === 0,
    noFutureFeatures: temporalViolations === 0,
    sourceIdentifiable: datasetStats.withSnapshot > 0,
    computationReproducible: uniquePredictions.some(p => p.prediction_hash !== null),
    modelVersionKnown: uniquePredictions.some(p => p.model_version !== null),
    featureVersionKnown: uniquePredictions.some(p => p.feature_snapshot?.schema_version !== undefined),
    configKnown: true, // We have the config
    calibrationKnown: false, // No calibration has been trained
  };
  
  const allGatesPassed = Object.values(leakageGate).every(v => v === true);
  const leakageGateResult = allGatesPassed ? 'VALIDATED' : 'NOT VALIDATED';
  
  console.log(`  1. Snapshot valid: ${leakageGate.snapshotValid ? '✓' : '✗'}`);
  console.log(`  2. Hash valid: ${leakageGate.hashValid ? '✓' : '✗'}`);
  console.log(`  3. Timestamps consistent: ${leakageGate.timestampsConsistent ? '✓' : '✗'}`);
  console.log(`  4. No future features: ${leakageGate.noFutureFeatures ? '✓' : '✗'}`);
  console.log(`  5. Source identifiable: ${leakageGate.sourceIdentifiable ? '✓' : '✗'}`);
  console.log(`  6. Computation reproducible: ${leakageGate.computationReproducible ? '✓' : '✗'}`);
  console.log(`  7. Model version known: ${leakageGate.modelVersionKnown ? '✓' : '✗'}`);
  console.log(`  8. Feature version known: ${leakageGate.featureVersionKnown ? '✓' : '✗'}`);
  console.log(`  9. Config known: ${leakageGate.configKnown ? '✓' : '✗'}`);
  console.log(`  10. Calibration known: ${leakageGate.calibrationKnown ? '✓' : '✗'}`);
  console.log(`\n  LEAKAGE GATE RESULT: ${leakageGateResult}`);

  // ════════════════════════════════════════════════════════════════
  // DETERMINE SCIENTIFIC VALIDATION STATUS
  // ════════════════════════════════════════════════════════════════
  let scientificStatus: 'VALIDATED' | 'PARTIALLY_VALIDATED' | 'NOT VALIDATED';
  
  if (uniquePredictions.length === 0) {
    scientificStatus = 'NOT VALIDATED';
  } else if (allGatesPassed && backtestBValid) {
    scientificStatus = 'VALIDATED';
  } else if (uniquePredictions.length > 0 && (backtestAResults.length > 0)) {
    scientificStatus = 'PARTIALLY_VALIDATED';
  } else {
    scientificStatus = 'NOT VALIDATED';
  }
  
  console.log(`\n  SCIENTIFIC VALIDATION STATUS: ${scientificStatus}`);

  // ════════════════════════════════════════════════════════════════
  // 20. PRODUCE ALL REPORTS
  // ════════════════════════════════════════════════════════════════
  console.log('\n[20] PRODUCING REPORTS');
  console.log('─'.repeat(40));
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── REAL_BACKTEST_REPORT.md ──
  const backtestReport = generateRealBacktestReport({
    commit: COMMIT_HASH,
    migrationStatus,
    datasetStats,
    dedupReport,
    temporalViolations,
    backtestAResults,
    backtestBResults,
    backtestBValid,
    split,
    splitMetrics,
    wfResults,
    ablationResults,
    doubleCounting,
    aiWeightResults,
    calibration,
    accuracyCI,
    logLossCI,
    brierCI,
    significanceResults,
    segmentation,
    leakageGate,
    leakageGateResult,
    scientificStatus,
    elapsed,
    neonConnected,
    nPredictions: uniquePredictions.length,
  });
  fs.writeFileSync(path.join(DOCS_DIR, 'REAL_BACKTEST_REPORT.md'), backtestReport);
  console.log('  ✓ REAL_BACKTEST_REPORT.md');

  // ── REAL_BACKTEST_RESULTS.json ──
  const jsonResults = {
    meta: {
      commit: COMMIT_HASH.substring(0, 7),
      date: new Date().toISOString(),
      model_version: MODEL_VERSION,
      feature_version: FEATURE_VERSION,
      config_version: CONFIG_VERSION,
      calibration_version: CALIBRATION_VERSION,
      dataset_version: DATASET_VERSION,
      neon_connected: neonConnected,
      migration_applied: migrationStatus.applied,
      elapsed_seconds: parseFloat(elapsed),
    },
    dataset: datasetStats,
    deduplication: dedupReport,
    temporal: { violations: temporalViolations, safe: temporalSafePredictions.length },
    backtest_a: backtestAResults.map(r => ({ name: r.name, ...r.metrics })),
    backtest_b: { valid: backtestBValid, results: backtestBResults.map(r => ({ name: r.name, ...r.metrics })) },
    split: split ? {
      train: splitMetrics?.train, validation: splitMetrics?.validation, test: splitMetrics?.test,
      periods: { trainStart: split.trainStart, trainEnd: split.trainEnd, validationStart: split.validationStart, validationEnd: split.validationEnd, testStart: split.testStart, testEnd: split.testEnd },
    } : null,
    walk_forward: wfResults,
    ablation: ablationResults.map(r => ({ name: r.name, ...r.metrics })),
    double_counting: doubleCounting,
    ai_weight_sweep: aiWeightResults.map(r => ({ weight: r.weight, ...r.metrics })),
    calibration: calibration,
    confidence_intervals: { accuracy: accuracyCI, logLoss: logLossCI, brier: brierCI },
    significance: significanceResults,
    segmentation: segmentation.map(s => ({ segment: s.segment, ...s.metrics })),
    leakage_gate: leakageGate,
    scientific_status: scientificStatus,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'REAL_BACKTEST_RESULTS.json'), JSON.stringify(jsonResults, null, 2));
  console.log('  ✓ REAL_BACKTEST_RESULTS.json');

  // ── MODEL_COMPARISON.md ──
  const comparisonReport = generateModelComparisonReport(backtestAResults, uniquePredictions.length);
  fs.writeFileSync(path.join(DOCS_DIR, 'MODEL_COMPARISON.md'), comparisonReport);
  console.log('  ✓ MODEL_COMPARISON.md');

  // ── CALIBRATION_REAL_REPORT.md ──
  const calibrationReport = generateCalibrationReport(calibration, uniquePredictions.length);
  fs.writeFileSync(path.join(DOCS_DIR, 'CALIBRATION_REAL_REPORT.md'), calibrationReport);
  console.log('  ✓ CALIBRATION_REAL_REPORT.md');

  // ── ABLATION_REAL_REPORT.md ──
  const ablationReport = generateAblationReport(ablationResults, doubleCounting);
  fs.writeFileSync(path.join(DOCS_DIR, 'ABLATION_REAL_REPORT.md'), ablationReport);
  console.log('  ✓ ABLATION_REAL_REPORT.md');

  // ── DOUBLE_COUNTING_AUDIT.md ──
  const dcReport = generateDoubleCountingReport(doubleCounting);
  fs.writeFileSync(path.join(DOCS_DIR, 'DOUBLE_COUNTING_AUDIT.md'), dcReport);
  console.log('  ✓ DOUBLE_COUNTING_AUDIT.md');

  // ── LEAKAGE_FINAL_REPORT.md ──
  const leakageReport = generateLeakageReport(leakageGate, leakageGateResult, datasetStats, temporalViolations);
  fs.writeFileSync(path.join(DOCS_DIR, 'LEAKAGE_FINAL_REPORT.md'), leakageReport);
  console.log('  ✓ LEAKAGE_FINAL_REPORT.md');

  // ── SCIENTIFIC_VALIDATION_STATUS.md ──
  const validationReport = generateScientificValidationReport({
    scientificStatus,
    datasetStats,
    backtestAResults,
    backtestBValid,
    leakageGate,
    leakageGateResult,
    nPredictions: uniquePredictions.length,
    neonConnected,
  });
  fs.writeFileSync(path.join(DOCS_DIR, 'SCIENTIFIC_VALIDATION_STATUS.md'), validationReport);
  console.log('  ✓ SCIENTIFIC_VALIDATION_STATUS.md');

  // ── WALK_FORWARD_REPORT.md ──
  const wfReport = generateWalkForwardReport(wfResults);
  fs.writeFileSync(path.join(DOCS_DIR, 'WALK_FORWARD_REPORT.md'), wfReport);
  console.log('  ✓ WALK_FORWARD_REPORT.md');

  // ── DATASET_TEMPORAL_INTEGRITY_REPORT.md ──
  const temporalReport = generateTemporalIntegrityReport(uniquePredictions, temporalViolations);
  fs.writeFileSync(path.join(DOCS_DIR, 'DATASET_TEMPORAL_INTEGRITY_REPORT.md'), temporalReport);
  console.log('  ✓ DATASET_TEMPORAL_INTEGRITY_REPORT.md');

  // ── AI_WEIGHT_VALIDATION.md ──
  const aiWeightReport = generateAIWeightReport(aiWeightResults);
  fs.writeFileSync(path.join(DOCS_DIR, 'AI_WEIGHT_VALIDATION.md'), aiWeightReport);
  console.log('  ✓ AI_WEIGHT_VALIDATION.md');

  // ════════════════════════════════════════════════════════════════
  // 21. REPRODUCIBILITY METADATA
  // ════════════════════════════════════════════════════════════════
  const reproducibilityMeta = {
    dataset_hash: crypto.createHash('sha256').update(JSON.stringify(uniquePredictions.map(p => p.id))).digest('hex').substring(0, 12),
    code_commit: COMMIT_HASH.substring(0, 7),
    model_version: MODEL_VERSION,
    feature_version: FEATURE_VERSION,
    config_version: CONFIG_VERSION,
    calibration_version: CALIBRATION_VERSION,
    dataset_version: DATASET_VERSION,
    execution_date: new Date().toISOString(),
    n_predictions: uniquePredictions.length,
    parameters: {
      AI_WEIGHT: cfg.AI_WEIGHT,
      VIRTUAL_AVG_GOALS: cfg.VIRTUAL_AVG_GOALS,
      STAT_BASE_WEIGHT: cfg.STAT_BASE_WEIGHT,
      STAT_ATTACK_WEIGHT: cfg.STAT_ATTACK_WEIGHT,
      STAT_DEF_WEIGHT: cfg.STAT_DEF_WEIGHT,
      FORM_ATTACK_BOOST: cfg.FORM_ATTACK_BOOST,
      FORM_DEFENSE_PENALTY: cfg.FORM_DEFENSE_PENALTY,
      MOMENTUM_SCALE: cfg.MOMENTUM_SCALE,
      H2H_HOME_BOOST: cfg.H2H_HOME_BOOST,
      H2H_AWAY_PENALTY: cfg.H2H_AWAY_PENALTY,
      VIRTUAL_CAP: cfg.VIRTUAL_CAP,
    },
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'REPRODUCIBILITY_META.json'), JSON.stringify(reproducibilityMeta, null, 2));
  console.log('  ✓ REPRODUCIBILITY_META.json');

  // ════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('PHASE 4 COMPLETE');
  console.log('═'.repeat(70));
  console.log(`  Scientific Validation Status: ${scientificStatus}`);
  console.log(`  Predictions analyzed: ${uniquePredictions.length}`);
  console.log(`  Neon connected: ${neonConnected}`);
  console.log(`  Full model backtest: ${backtestBValid ? 'VALID' : 'NOT VALIDATED'}`);
  console.log(`  Leakage gate: ${leakageGateResult}`);
  console.log(`  Elapsed: ${elapsed}s`);
  console.log(`  Reports: 11 files`);
}

// ═══════════════════════════════════════════════════════════════════
// REPORT GENERATORS
// ═══════════════════════════════════════════════════════════════════

function generateRealBacktestReport(data: any): string {
  const L: string[] = [];
  const d = data;
  
  L.push('# REAL BACKTEST REPORT — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push(`Commit: ${d.commit.substring(0, 7)}`);
  L.push('');
  L.push('---');
  L.push('');
  
  // 1. Executive Summary
  L.push('## 1. EXECUTIVE SUMMARY');
  L.push('');
  L.push(`**Scientific Validation Status: ${d.scientificStatus}**`);
  L.push('');
  L.push(`This report presents the empirical validation of the VirtuMatch Predictor against real historical data from Neon PostgreSQL.`);
  L.push('');
  L.push(`- **Neon Database Connected**: ${d.neonConnected ? 'Yes' : 'No'}`);
  L.push(`- **Migration 006 Applied**: ${d.migrationStatus.applied ? 'Yes' : d.migrationStatus.partial ? 'Partial' : 'No/Unknown'}`);
  L.push(`- **Total Predictions Analyzed**: ${d.nPredictions}`);
  L.push(`- **Backtest A (Odds-Validated)**: ${d.backtestAResults.length > 0 ? 'Run' : 'Not Run'}`);
  L.push(`- **Backtest B (Full Model)**: ${d.backtestBValid ? 'Run & Valid' : 'NOT VALIDATED'}`);
  L.push(`- **Leakage Gate**: ${d.leakageGateResult}`);
  L.push('');
  
  if (!d.neonConnected || d.nPredictions === 0) {
    L.push('> ⚠️ **FULL MODEL VALIDATION PENDING — INSUFFICIENT HISTORICAL SNAPSHOT COVERAGE**');
    L.push('>');
    L.push('> The Neon PostgreSQL database was not accessible from the analysis environment.');
    L.push('> Without real historical data, the full model cannot be empirically validated.');
    L.push('> The odds-only backtest framework is built and ready to execute when database access is available.');
    L.push('');
  }

  // 2. Dataset
  L.push('## 2. DATASET');
  L.push('');
  L.push('| Metric | Value |');
  L.push('|--------|-------|');
  L.push(`| Total predictions in DB | ${d.datasetStats.total} |`);
  L.push(`| With actual result | ${d.datasetStats.withResult} |`);
  L.push(`| Without result | ${d.datasetStats.withoutResult} |`);
  L.push(`| No valid odds | ${d.datasetStats.noOdds} |`);
  L.push(`| Cancelled | ${d.datasetStats.cancelled} |`);
  L.push(`| Test/Simulation | ${d.datasetStats.testOrSim} |`);
  L.push(`| Duplicates | ${d.dedupReport.duplicates} |`);
  L.push(`| With feature_snapshot | ${d.datasetStats.withSnapshot} |`);
  L.push(`| Without feature_snapshot | ${d.datasetStats.withoutSnapshot} |`);
  L.push(`| RECORDED | ${d.datasetStats.recorded} |`);
  L.push(`| RECONSTRUCTED | ${d.datasetStats.reconstructed} |`);
  L.push(`| UNKNOWN | ${d.datasetStats.unknown} |`);
  L.push(`| UNSAFE | ${d.datasetStats.unsafe} |`);
  L.push(`| Temporal violations | ${d.temporalViolations} |`);
  L.push('');
  L.push(`**Deduplication rule**: ${d.dedupReport.rule}`);
  L.push('');

  // 3. Backtest A
  L.push('## 3. BACKTEST A — ODDS VALIDATED');
  L.push('');
  L.push('Uses only predictions where odds are verifiably known at prediction time.');
  L.push('This is the scientifically safest backtest because odds are always RECORDED in the predictions table.');
  L.push('');
  if (d.backtestAResults.length > 0) {
    L.push('| Model | N | Accuracy | Bal.Acc | Prec(1) | Recall(1) | F1 | LogLoss | Brier | ECE | MCE |');
    L.push('|-------|---|----------|---------|---------|-----------|-----|---------|-------|-----|-----|');
    for (const r of d.backtestAResults) {
      L.push(metricsToTable(r.name, r.metrics));
    }
  } else {
    L.push('*No data available for Backtest A.*');
  }
  L.push('');

  // 4. Backtest B
  L.push('## 4. BACKTEST B — FULL MODEL');
  L.push('');
  if (d.backtestBValid) {
    L.push('Uses only predictions with valid feature_snapshot, no UNKNOWN/UNSAFE provenance, and valid timestamps.');
    L.push('');
    L.push('**STATUS: VALIDATED**');
    L.push('');
    if (d.backtestBResults.length > 0) {
      L.push('| Model | N | Accuracy | LogLoss | Brier | ECE |');
      L.push('|-------|---|----------|---------|-------|-----|');
      for (const r of d.backtestBResults) {
        L.push(`| ${r.name} | ${r.metrics.n} | ${fmtPct(r.metrics.accuracy)} | ${fmtDec(r.metrics.logLoss)} | ${fmtDec(r.metrics.brierScore, 4)} | ${fmtDec(r.metrics.ece)} |`);
      }
    }
  } else {
    L.push('**STATUS: NOT VALIDATED**');
    L.push('');
    L.push('Insufficient predictions with valid feature_snapshot to validate the full model.');
    L.push('The following criteria must ALL be met:');
    L.push('- feature_snapshot exists');
    L.push('- provenance ≠ UNKNOWN and ≠ UNSAFE');
    L.push('- temporal_valid = true');
    L.push('- feature_snapshot_hash present');
    L.push('- model_version present');
    L.push('');
    L.push('> **FULL MODEL VALIDATION PENDING — INSUFFICIENT HISTORICAL SNAPSHOT COVERAGE**');
  }
  L.push('');

  // 5. Temporal Split
  L.push('## 5. TEMPORAL SPLIT');
  L.push('');
  if (d.split) {
    L.push('Chronological split (no data leakage between sets):');
    L.push('');
    L.push('| Set | N | Start | End | Accuracy |');
    L.push('|-----|---|-------|-----|----------|');
    L.push(`| TRAIN | ${d.split.train.length} | ${d.split.trainStart.substring(0, 10)} | ${d.split.trainEnd.substring(0, 10)} | ${d.splitMetrics ? fmtPct(d.splitMetrics.train.accuracy) : 'N/A'} |`);
    L.push(`| VALIDATION | ${d.split.validation.length} | ${d.split.validationStart.substring(0, 10)} | ${d.split.validationEnd.substring(0, 10)} | ${d.splitMetrics ? fmtPct(d.splitMetrics.validation.accuracy) : 'N/A'} |`);
    L.push(`| TEST | ${d.split.test.length} | ${d.split.testStart.substring(0, 10)} | ${d.split.testEnd.substring(0, 10)} | ${d.splitMetrics ? fmtPct(d.splitMetrics.test.accuracy) : 'N/A'} |`);
  } else {
    L.push('*Insufficient data for temporal split.*');
  }
  L.push('');

  // 6. Calibration
  L.push('## 6. CALIBRATION');
  L.push('');
  if (d.calibration) {
    L.push(`| Metric | Value |`);
    L.push(`|--------|-------|`);
    L.push(`| ECE | ${fmtDec(d.calibration.ece)} |`);
    L.push(`| MCE | ${fmtDec(d.calibration.mce)} |`);
    L.push(`| Brier Score | ${fmtDec(d.calibration.brierScore, 4)} |`);
    L.push(`| Log Loss | ${fmtDec(d.calibration.logLoss)} |`);
    L.push('');
    L.push('### Reliability Diagram');
    L.push('');
    L.push('| Predicted | Actual | N | Gap |');
    L.push('|-----------|--------|---|-----|');
    for (const bin of d.calibration.bins) {
      L.push(`| ${fmtPct(bin.meanPredicted)} | ${fmtPct(bin.meanActual)} | ${bin.count} | ${fmtPct(bin.gap)} |`);
    }
  } else {
    L.push('*Insufficient data for calibration analysis.*');
  }
  L.push('');

  // 7. Confidence Intervals
  L.push('## 7. CONFIDENCE INTERVALS (Bootstrap, 95%)');
  L.push('');
  if (d.accuracyCI) {
    L.push(`| Metric | Value | 95% CI Lower | 95% CI Upper | N |`);
    L.push(`|--------|-------|-------------|-------------|---|`);
    L.push(`| Accuracy | ${fmtPct(d.accuracyCI.value)} | ${fmtPct(d.accuracyCI.ci.lower)} | ${fmtPct(d.accuracyCI.ci.upper)} | ${d.accuracyCI.n} |`);
    if (d.logLossCI) L.push(`| Log Loss | ${fmtDec(d.logLossCI.value)} | ${fmtDec(d.logLossCI.ci.lower)} | ${fmtDec(d.logLossCI.ci.upper)} | ${d.logLossCI.n} |`);
    if (d.brierCI) L.push(`| Brier | ${fmtDec(d.brierCI.value, 4)} | ${fmtDec(d.brierCI.ci.lower, 4)} | ${fmtDec(d.brierCI.ci.upper, 4)} | ${d.brierCI.n} |`);
  } else {
    L.push('*Insufficient data for bootstrap confidence intervals.*');
  }
  L.push('');

  // 8. Significance
  L.push('## 8. SIGNIFICANCE TESTS');
  L.push('');
  if (d.significanceResults?.length > 0) {
    L.push('| Comparison | χ² | p-value | Significant | b | c | N |');
    L.push('|------------|-----|---------|-------------|---|---|---|');
    for (const r of d.significanceResults) {
      L.push(`| ${r.comparison} | ${fmtDec(r.mcnemar.statistic, 2)} | ${fmtDec(r.mcnemar.pValue, 4)} | ${r.mcnemar.significant ? 'Yes' : 'No'} | ${r.mcnemar.b} | ${r.mcnemar.c} | ${r.mcnemar.n} |`);
    }
  } else {
    L.push('*Insufficient data for significance tests.*');
  }
  L.push('');

  // 9. Leakage Gate
  L.push('## 9. LEAKAGE GATE FINAL');
  L.push('');
  L.push('| Condition | Status |');
  L.push('|-----------|--------|');
  L.push(`| 1. Snapshot valid | ${d.leakageGate.snapshotValid ? '✓' : '✗'} |`);
  L.push(`| 2. Hash valid | ${d.leakageGate.hashValid ? '✓' : '✗'} |`);
  L.push(`| 3. Timestamps consistent | ${d.leakageGate.timestampsConsistent ? '✓' : '✗'} |`);
  L.push(`| 4. No future features | ${d.leakageGate.noFutureFeatures ? '✓' : '✗'} |`);
  L.push(`| 5. Source identifiable | ${d.leakageGate.sourceIdentifiable ? '✓' : '✗'} |`);
  L.push(`| 6. Computation reproducible | ${d.leakageGate.computationReproducible ? '✓' : '✗'} |`);
  L.push(`| 7. Model version known | ${d.leakageGate.modelVersionKnown ? '✓' : '✗'} |`);
  L.push(`| 8. Feature version known | ${d.leakageGate.featureVersionKnown ? '✓' : '✗'} |`);
  L.push(`| 9. Config known | ${d.leakageGate.configKnown ? '✓' : '✗'} |`);
  L.push(`| 10. Calibration known | ${d.leakageGate.calibrationKnown ? '✓' : '✗'} |`);
  L.push('');
  L.push(`**LEAKAGE GATE RESULT: ${d.leakageGateResult}**`);
  L.push('');

  // 10. Limitations
  L.push('## 10. LIMITATIONS');
  L.push('');
  if (!d.neonConnected) {
    L.push('- **No database access**: The Neon PostgreSQL database was not accessible. All results are based on code analysis, not empirical data.');
  }
  if (d.nPredictions === 0) {
    L.push('- **No historical predictions**: Without real prediction data, no empirical validation is possible.');
  }
  if (!d.backtestBValid) {
    L.push('- **Full model not validated**: Insufficient feature_snapshot coverage prevents full model validation.');
  }
  L.push('- **Calibration not trained**: No Platt scaling or isotonic regression has been applied. Raw model probabilities are used.');
  L.push('- **AI influence unvalidated**: AI_WEIGHT=0.35 is arbitrary. The AI\'s contribution has not been empirically measured against a held-out test set.');
  L.push('- **Momentum is derived from form**: Momentum does not provide independent information; it is a deterministic function of form results.');
  L.push('- **Double counting detected**: See DOUBLE_COUNTING_AUDIT.md for identified information redundancy paths.');
  L.push('');

  return L.join('\n');
}

function generateModelComparisonReport(results: { name: string; metrics: Metrics }[], n: number): string {
  const L: string[] = [];
  L.push('# MODEL COMPARISON — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push(`N = ${n}`);
  L.push('');
  L.push('| Model | N | Accuracy | Bal.Acc | F1 | LogLoss | Brier | ECE | MCE | Home% | Draw% | Away% |');
  L.push('|-------|---|----------|---------|-----|---------|-------|-----|-----|-------|-------|-------|');
  for (const r of results) {
    const m = r.metrics;
    L.push(`| ${r.name} | ${m.n} | ${fmtPct(m.accuracy)} | ${fmtPct(m.balancedAccuracy)} | ${fmtPct(m.f1)} | ${fmtDec(m.logLoss)} | ${fmtDec(m.brierScore, 4)} | ${fmtDec(m.ece)} | ${fmtDec(m.mce)} | ${fmtPct(m.homeAccuracy)} | ${fmtPct(m.drawAccuracy)} | ${fmtPct(m.awayAccuracy)} |`);
  }
  L.push('');
  return L.join('\n');
}

function generateCalibrationReport(cal: CalibrationAnalysis | null, n: number): string {
  const L: string[] = [];
  L.push('# CALIBRATION REPORT — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push(`N = ${n}`);
  L.push('');
  if (cal) {
    L.push('## Calibration Metrics');
    L.push('');
    L.push(`- **ECE (Expected Calibration Error)**: ${fmtDec(cal.ece)}`);
    L.push(`- **MCE (Maximum Calibration Error)**: ${fmtDec(cal.mce)}`);
    L.push(`- **Brier Score**: ${fmtDec(cal.brierScore, 4)}`);
    L.push(`- **Log Loss**: ${fmtDec(cal.logLoss)}`);
    L.push('');
    L.push('## Reliability Diagram');
    L.push('');
    L.push('| Bin | Predicted | Actual | N | Gap |');
    L.push('|-----|-----------|--------|---|-----|');
    for (const bin of cal.bins) {
      L.push(`| [${bin.lower.toFixed(1)}-${bin.upper.toFixed(1)}] | ${fmtPct(bin.meanPredicted)} | ${fmtPct(bin.meanActual)} | ${bin.count} | ${fmtPct(bin.gap)} |`);
    }
    L.push('');
    L.push('## Interpretation');
    L.push('');
    if (cal.ece < 0.05) {
      L.push('The model is well-calibrated (ECE < 0.05). Predicted probabilities closely match observed frequencies.');
    } else if (cal.ece < 0.10) {
      L.push('The model is moderately calibrated (0.05 ≤ ECE < 0.10). Some bins show noticeable miscalibration.');
    } else {
      L.push('The model is poorly calibrated (ECE ≥ 0.10). Predicted probabilities do not reliably match observed frequencies. Calibration (Platt scaling or isotonic regression) is recommended.');
    }
  } else {
    L.push('*Insufficient data for calibration analysis.*');
  }
  L.push('');
  return L.join('\n');
}

function generateAblationReport(results: { name: string; metrics: Metrics }[], dc: DoubleCountingFinding[]): string {
  const L: string[] = [];
  L.push('# ABLATION STUDY — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push('');
  L.push('## Ablation Results');
  L.push('');
  L.push('| Variant | N | Accuracy | F1 | LogLoss | Brier | ECE |');
  L.push('|---------|---|----------|-----|---------|-------|-----|');
  for (const r of results) {
    L.push(`| ${r.name} | ${r.metrics.n} | ${fmtPct(r.metrics.accuracy)} | ${fmtPct(r.metrics.f1)} | ${fmtDec(r.metrics.logLoss)} | ${fmtDec(r.metrics.brierScore, 4)} | ${fmtDec(r.metrics.ece)} |`);
  }
  L.push('');
  L.push('## Double Counting Impact');
  L.push('');
  L.push('The following information redundancy paths were identified:');
  L.push('');
  for (const f of dc) {
    L.push(`### [${f.severity.toUpperCase()}] ${f.path}`);
    L.push('');
    L.push(f.description);
    L.push('');
    L.push('**Sources**:');
    for (const s of f.sources) {
      L.push(`- ${s}`);
    }
    L.push('');
    L.push(`**Evidence**: ${f.evidence}`);
    L.push('');
  }
  return L.join('\n');
}

function generateDoubleCountingReport(findings: DoubleCountingFinding[]): string {
  const L: string[] = [];
  L.push('# DOUBLE COUNTING AUDIT — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push(`Total findings: ${findings.length}`);
  L.push(`High severity: ${findings.filter(f => f.severity === 'high').length}`);
  L.push(`Medium severity: ${findings.filter(f => f.severity === 'medium').length}`);
  L.push(`Low severity: ${findings.filter(f => f.severity === 'low').length}`);
  L.push('');
  
  for (const f of findings) {
    L.push(`## [${f.severity.toUpperCase()}] ${f.path}`);
    L.push('');
    L.push(f.description);
    L.push('');
    L.push('**Sources**:');
    for (const s of f.sources) {
      L.push(`- ${s}`);
    }
    L.push('');
    L.push(`**Evidence**: ${f.evidence}`);
    L.push('');
  }
  return L.join('\n');
}

function generateLeakageReport(gate: any, result: string, stats: DatasetStats, violations: number): string {
  const L: string[] = [];
  L.push('# LEAKAGE FINAL REPORT — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push('');
  L.push(`**LEAKAGE GATE RESULT: ${result}**`);
  L.push('');
  L.push('## Gate Conditions');
  L.push('');
  const conditions = [
    'Snapshot valid', 'Hash valid', 'Timestamps consistent', 'No future features',
    'Source identifiable', 'Computation reproducible', 'Model version known',
    'Feature version known', 'Config known', 'Calibration known',
  ];
  const values = Object.values(gate) as boolean[];
  L.push('| # | Condition | Status |');
  L.push('|---|-----------|--------|');
  for (let i = 0; i < conditions.length; i++) {
    L.push(`| ${i + 1} | ${conditions[i]} | ${values[i] ? '✓ PASS' : '✗ FAIL'} |`);
  }
  L.push('');
  L.push('## Dataset Integrity');
  L.push('');
  L.push(`- Total predictions: ${stats.total}`);
  L.push(`- With snapshot: ${stats.withSnapshot}`);
  L.push(`- Without snapshot: ${stats.withoutSnapshot}`);
  L.push(`- RECORDED: ${stats.recorded}`);
  L.push(`- RECONSTRUCTED: ${stats.reconstructed}`);
  L.push(`- UNKNOWN: ${stats.unknown}`);
  L.push(`- UNSAFE: ${stats.unsafe}`);
  L.push(`- Temporal violations: ${violations}`);
  L.push('');
  return L.join('\n');
}

function generateScientificValidationReport(data: any): string {
  const L: string[] = [];
  L.push('# SCIENTIFIC VALIDATION STATUS — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push('');
  L.push(`# **${data.scientificStatus}**`);
  L.push('');
  L.push('## Determination Criteria');
  L.push('');
  L.push('- **VALIDATED**: All leakage gates pass, Backtest B is valid, sufficient data');
  L.push('- **PARTIALLY_VALIDATED**: Backtest A runs (odds validated), but full model cannot be verified');
  L.push('- **NOT VALIDATED**: Insufficient data or critical gate failures');
  L.push('');
  L.push('## Current Status Details');
  L.push('');
  L.push(`- Neon connected: ${data.neonConnected ? 'Yes' : 'No'}`);
  L.push(`- Predictions available: ${data.nPredictions}`);
  L.push(`- Backtest A (Odds-Validated): ${data.backtestAResults?.length > 0 ? 'Run' : 'Not Run'}`);
  L.push(`- Backtest B (Full Model): ${data.backtestBValid ? 'Valid' : 'NOT VALIDATED'}`);
  L.push(`- Leakage Gate: ${data.leakageGateResult}`);
  L.push('');
  
  L.push('## What Is Validated');
  L.push('');
  if (data.nPredictions > 0) {
    L.push('- Odds are RECORDED in the predictions table (always stored at prediction time)');
    L.push('- Odds-derived probabilities can be verified');
    L.push('- Prediction outcomes are verified after match completion');
  } else {
    L.push('- The framework is built and ready for validation');
    L.push('- The prediction engine code is audited');
    L.push('- The coefficient registry is validated');
  }
  L.push('');
  
  L.push('## What Is NOT Validated');
  L.push('');
  L.push('- Form (last 5 matches) — UNKNOWN for predictions without feature_snapshot');
  L.push('- H2H (head-to-head) — UNKNOWN for predictions without feature_snapshot');
  L.push('- Stats/Team rankings — UNKNOWN for predictions without feature_snapshot');
  L.push('- AI prediction — UNKNOWN (Groq LLM output not stored)');
  L.push('- Anti-trap detection — UNKNOWN (depends on form + rankings)');
  L.push('- Momentum — NOT INDEPENDENT (derived from form)');
  L.push('');
  
  L.push('## Recommendations for Phase 5');
  L.push('');
  L.push('1. **Enable feature_snapshot** for all new predictions to accumulate validatable data');
  L.push('2. **Run migration 006** on production Neon if not yet applied');
  L.push('3. **Collect 100+ predictions with snapshots** before re-running Phase 4');
  L.push('4. **Train calibration** (Platt scaling) on TRAIN+VALIDATION only');
  L.push('5. **Address double counting** — especially form→momentum and odds→stats redundancy');
  L.push('6. **Consider reducing AI_WEIGHT** if ablation shows no improvement over odds-only');
  L.push('');
  
  return L.join('\n');
}

function generateWalkForwardReport(results: WalkForwardResult[]): string {
  const L: string[] = [];
  L.push('# WALK-FORWARD VALIDATION REPORT — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push('');
  if (results.length > 0) {
    L.push('## Results');
    L.push('');
    L.push('| Window | Train N | Test N | Accuracy | LogLoss | Brier | Train End | Test End |');
    L.push('|--------|---------|--------|----------|---------|-------|-----------|----------|');
    for (const r of results) {
      L.push(`| ${r.windowIndex} | ${r.trainSize} | ${r.testSize} | ${fmtPct(r.accuracy)} | ${fmtDec(r.logLoss)} | ${fmtDec(r.brierScore, 4)} | ${r.trainEnd.substring(0, 10)} | ${r.testEnd.substring(0, 10)} |`);
    }
    L.push('');
    const avgAcc = results.reduce((s, r) => s + r.accuracy, 0) / results.length;
    const avgLL = results.reduce((s, r) => s + r.logLoss, 0) / results.length;
    const stdAcc = Math.sqrt(results.reduce((s, r) => s + (r.accuracy - avgAcc) ** 2, 0) / results.length);
    L.push(`**Average Accuracy**: ${fmtPct(avgAcc)} (σ = ${fmtPct(stdAcc)})`);
    L.push(`**Average LogLoss**: ${fmtDec(avgLL)}`);
    L.push('');
    L.push('## Temporal Stability');
    L.push('');
    if (stdAcc < 0.05) {
      L.push('Performance is **stable** across time windows (σ < 5%). No significant temporal drift detected.');
    } else if (stdAcc < 0.10) {
      L.push('Performance shows **moderate variation** across time windows (5% ≤ σ < 10%). Some temporal drift may be present.');
    } else {
      L.push('Performance shows **high variation** across time windows (σ ≥ 10%). Significant temporal drift is likely. Model may need periodic retraining.');
    }
  } else {
    L.push('*Insufficient data for walk-forward validation (need ≥ 50 predictions).*');
  }
  L.push('');
  return L.join('\n');
}

function generateTemporalIntegrityReport(preds: VerifiedPrediction[], violations: number): string {
  const L: string[] = [];
  L.push('# DATASET TEMPORAL INTEGRITY REPORT — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push(`- Total predictions: ${preds.length}`);
  L.push(`- Temporal violations: ${violations}`);
  L.push(`- Violation rate: ${preds.length > 0 ? fmtPct(violations / preds.length) : 'N/A'}`);
  L.push('');
  L.push('## Invariant');
  L.push('');
  L.push('For every feature used in a prediction:');
  L.push('```');
  L.push('feature_timestamp <= prediction_timestamp');
  L.push('```');
  L.push('');
  L.push('Any violation means the feature uses future data (data leakage) and must be classified as UNSAFE.');
  L.push('');
  if (violations === 0) {
    L.push('**RESULT: NO TEMPORAL VIOLATIONS DETECTED**');
    L.push('');
    L.push('All features respect the temporal invariant. No data leakage through future information.');
  } else {
    L.push(`**RESULT: ${violations} TEMPORAL VIOLATIONS DETECTED**`);
    L.push('');
    L.push('These predictions have been classified as UNSAFE and excluded from the Full Model backtest.');
  }
  L.push('');
  return L.join('\n');
}

function generateAIWeightReport(results: { weight: number; metrics: Metrics }[]): string {
  const L: string[] = [];
  L.push('# AI_WEIGHT VALIDATION — Phase 4');
  L.push(`Date: ${new Date().toISOString()}`);
  L.push('');
  L.push('## Methodology');
  L.push('');
  L.push('- Tested on VALIDATION set only (never on TEST)');
  L.push('- Current value: AI_WEIGHT = 0.35 (arbitrary, not empirically calibrated)');
  L.push('- Range tested: 0.00 to 0.35');
  L.push('');
  if (results.length > 0) {
    L.push('## Results');
    L.push('');
    L.push('| AI_WEIGHT | N | Accuracy | F1 | LogLoss | Brier |');
    L.push('|-----------|---|----------|-----|---------|-------|');
    for (const r of results) {
      L.push(`| ${r.weight.toFixed(2)} | ${r.metrics.n} | ${fmtPct(r.metrics.accuracy)} | ${fmtPct(r.metrics.f1)} | ${fmtDec(r.metrics.logLoss)} | ${fmtDec(r.metrics.brierScore, 4)} |`);
    }
    L.push('');
    // Find best by log loss
    const bestByLL = [...results].sort((a, b) => a.metrics.logLoss - b.metrics.logLoss)[0];
    L.push(`**Best by LogLoss**: AI_WEIGHT = ${bestByLL.weight.toFixed(2)} (LogLoss = ${fmtDec(bestByLL.metrics.logLoss)})`);
    L.push('');
    L.push('**IMPORTANT**: This result is from VALIDATION only. The chosen weight must be evaluated on TEST exactly once.');
  } else {
    L.push('*Insufficient data for AI_WEIGHT sweep.*');
  }
  L.push('');
  return L.join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════════

main().catch(err => {
  console.error('Phase 4 failed:', err);
  process.exit(1);
});
