// ============================================
// PHASE 5.3.22.2 — SCORE + CONFIDENCE + 1X2 TRACE
// Comprehensive measurement of all three outputs across all ablations.
//
// READ-ONLY: no network, no Groq, no DB, no future data.
// NO production code modification.
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { analyzeMatch, type TeamStats, type HistoricalResult } from '../src/lib/prediction-engine';
import { reconstructMatchInputFromSnapshot, type StoredFeatureSnapshot } from '../src/lib/snapshot-reconstruction';
import {
  ABLATION_MATRIX,
  runAblation,
  poissonOnlyBaseline,
  normalizedOddsBaseline,
  type AblationResult,
  type AblationVariant,
} from './backtest-engine';

// ═══════════════════════════════════════════════════════════════════
// POISSON HELPERS (independent implementation for instrumentation)
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

// ═══════════════════════════════════════════════════════════════════
// 1X2 CHAIN INSTRUMENTATION (for 6 representative snapshots)
// ═══════════════════════════════════════════════════════════════════

interface InstrumentationTrace {
  prediction_id: string;
  home_team: string;
  away_team: string;
  odds: { home: number; draw: number; away: number };
  normalized_odds: { home: number; draw: number; away: number };
  grid_search_lambdas: { lambdaH: number; lambdaA: number };
  poisson_1x2: { home: number; draw: number; away: number };
  final_1x2: { home: number; draw: number; away: number };
  distances: {
    poisson_vs_normalized: { home: number; draw: number; away: number };
    final_vs_normalized: { home: number; draw: number; away: number };
    final_vs_poisson: { home: number; draw: number; away: number };
  };
  favorite_prob: number;
}

function instrument1X2Chain(
  snapshot: StoredFeatureSnapshot,
  homeTeam: string,
  awayTeam: string,
  league: string,
  predictionId: string,
): InstrumentationTrace {
  const odds = snapshot.odds;
  const oddHome = odds.home;
  const oddDraw = odds.draw;
  const oddAway = odds.away;

  // Step 1: Normalized odds
  const invH = 1 / oddHome, invD = 1 / oddDraw, invA = 1 / oddAway;
  const total = invH + invD + invA;
  const normH = invH / total, normD = invD / total, normA = invA / total;

  // Step 2: Grid search lambdas (find lambdas that produce the normalized odds via Poisson)
  const { lambdaH, lambdaA } = gridSearchLambdas(normH, normD, normA);

  // Step 3: Poisson 1X2 from those lambdas
  const { pH, pD, pA } = compute1X2FromLambdas(lambdaH, lambdaA);
  const poissonSum = pH + pD + pA;
  const poissonH = pH / poissonSum;
  const poissonD = pD / poissonSum;
  const poissonA = pA / poissonSum;

  // Step 4: Final 1X2 (from analyzeMatch — includes stats/form/H2H adjustments + redistribution)
  const recon = reconstructMatchInputFromSnapshot(snapshot, homeTeam, awayTeam, league);
  const matchResult = analyzeMatch(recon.match, undefined, recon.teamStats, recon.historicalResults);
  const finalH = matchResult.probHome;
  const finalD = matchResult.probDraw;
  const finalA = matchResult.probAway;

  // Compute distances
  const poissonVsNorm = {
    home: Math.abs(poissonH - normH),
    draw: Math.abs(poissonD - normD),
    away: Math.abs(poissonA - normA),
  };
  const finalVsNorm = {
    home: Math.abs(finalH - normH),
    draw: Math.abs(finalD - normD),
    away: Math.abs(finalA - normA),
  };
  const finalVsPoisson = {
    home: Math.abs(finalH - poissonH),
    draw: Math.abs(finalD - poissonD),
    away: Math.abs(finalA - poissonA),
  };

  // Favorite probability
  let favoriteProb = 0;
  if (normH >= normD && normH >= normA) favoriteProb = normH;
  else if (normA >= normD) favoriteProb = normA;
  else favoriteProb = normD;

  return {
    prediction_id: predictionId,
    home_team: homeTeam,
    away_team: awayTeam,
    odds: { home: oddHome, draw: oddDraw, away: oddAway },
    normalized_odds: { home: normH, draw: normD, away: normA },
    grid_search_lambdas: { lambdaH, lambdaA },
    poisson_1x2: { home: poissonH, draw: poissonD, away: poissonA },
    final_1x2: { home: finalH, draw: finalD, away: finalA },
    distances: {
      poisson_vs_normalized: poissonVsNorm,
      final_vs_normalized: finalVsNorm,
      final_vs_poisson: finalVsPoisson,
    },
    favorite_prob: favoriteProb,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SCORE + CONFIDENCE MEASUREMENT
// ═══════════════════════════════════════════════════════════════════

const SNAPSHOTS_FILE = '/home/z/my-project/download/snapshots-for-measurement.json';
const OUTPUT_FILE = '/home/z/my-project/download/score-confidence-1x2-results.json';

async function main() {
  console.log('═'.repeat(78));
  console.log('  PHASE 5.3.22.2 — SCORE + CONFIDENCE + 1X2 TRACE');
  console.log('═'.repeat(78));

  const rawData = JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8'));
  console.log(`\n  Loaded ${rawData.length} snapshots\n`);

  // ════════════════════════════════════════════════════════════════
  // PART A: 1X2 CHAIN INSTRUMENTATION (6 representative snapshots)
  // ════════════════════════════════════════════════════════════════

  // Select 6 representative snapshots: 2 strong home, 2 balanced, 2 strong away
  const withOddsRatio = rawData.map((r: any) => ({
    ...r,
    homeFav: 1 / r.feature_snapshot.odds.home,
    awayFav: 1 / r.feature_snapshot.odds.away,
    ratio: (1 / r.feature_snapshot.odds.home) / (1 / r.feature_snapshot.odds.away),
  }));

  // Sort by ratio descending (high ratio = strong home favorite)
  const sortedByRatio = [...withOddsRatio].sort((a, b) => b.ratio - a.ratio);
  const strongHome = sortedByRatio.slice(0, 2);
  const balanced = sortedByRatio.slice(Math.floor(sortedByRatio.length / 2) - 1, Math.floor(sortedByRatio.length / 2) + 1);
  const strongAway = sortedByRatio.slice(-2);

  const selected = [...strongHome, ...balanced, ...strongAway];

  console.log('  ── PART A: 1X2 CHAIN INSTRUMENTATION (6 snapshots) ──\n');

  const traces: InstrumentationTrace[] = [];
  for (const row of selected) {
    const snap = row.feature_snapshot as StoredFeatureSnapshot;
    const trace = instrument1X2Chain(snap, row.home_team, row.away_team, row.league || 'Unknown', row.id);
    traces.push(trace);

    console.log(`  ${row.home_team} vs ${row.away_team}`);
    console.log(`    Odds: ${trace.odds.home}/${trace.odds.draw}/${trace.odds.away}`);
    console.log(`    Normalized: H=${trace.normalized_odds.home.toFixed(6)} D=${trace.normalized_odds.draw.toFixed(6)} A=${trace.normalized_odds.away.toFixed(6)}`);
    console.log(`    Lambdas: λH=${trace.grid_search_lambdas.lambdaH} λA=${trace.grid_search_lambdas.lambdaA}`);
    console.log(`    Poisson:  H=${trace.poisson_1x2.home.toFixed(6)} D=${trace.poisson_1x2.draw.toFixed(6)} A=${trace.poisson_1x2.away.toFixed(6)}`);
    console.log(`    Final:    H=${trace.final_1x2.home.toFixed(6)} D=${trace.final_1x2.draw.toFixed(6)} A=${trace.final_1x2.away.toFixed(6)}`);
    console.log(`    Dist(poisson vs norm): H=${trace.distances.poisson_vs_normalized.home.toFixed(6)} D=${trace.distances.poisson_vs_normalized.draw.toFixed(6)} A=${trace.distances.poisson_vs_normalized.away.toFixed(6)}`);
    console.log(`    Dist(final vs norm):   H=${trace.distances.final_vs_normalized.home.toFixed(6)} D=${trace.distances.final_vs_normalized.draw.toFixed(6)} A=${trace.distances.final_vs_normalized.away.toFixed(6)}`);
    console.log(`    Dist(final vs poisson): H=${trace.distances.final_vs_poisson.home.toFixed(6)} D=${trace.distances.final_vs_poisson.draw.toFixed(6)} A=${trace.distances.final_vs_poisson.away.toFixed(6)}`);
    console.log();
  }

  // Determine STEP_WHERE_ODDS_ALIGNMENT_IS_ESTABLISHED
  const avgPoissonVsNorm = traces.reduce((s, t) => s + t.distances.poisson_vs_normalized.home, 0) / traces.length;
  const avgFinalVsNorm = traces.reduce((s, t) => s + t.distances.final_vs_normalized.home, 0) / traces.length;
  const avgFinalVsPoisson = traces.reduce((s, t) => s + t.distances.final_vs_poisson.home, 0) / traces.length;

  console.log(`  Average distances (home prob):`);
  console.log(`    Poisson vs Normalized: ${avgPoissonVsNorm.toFixed(6)}`);
  console.log(`    Final vs Normalized:   ${avgFinalVsNorm.toFixed(6)}`);
  console.log(`    Final vs Poisson:      ${avgFinalVsPoisson.toFixed(6)}`);

  let stepWhereAligned = 'NOT_DETERMINED';
  if (avgPoissonVsNorm < 0.001 && avgFinalVsNorm < 0.001) {
    stepWhereAligned = 'GRID_SEARCH';
  } else if (avgPoissonVsNorm < 0.001 && avgFinalVsNorm >= 0.001) {
    stepWhereAligned = 'REDISTRIBUTION';
  } else if (avgPoissonVsNorm >= 0.001 && avgFinalVsNorm < 0.001) {
    stepWhereAligned = 'REDISTRIBUTION';
  } else if (avgFinalVsPoisson < 0.001) {
    stepWhereAligned = 'POISSON';
  }

  console.log(`\n  STEP_WHERE_ODDS_ALIGNMENT_IS_ESTABLISHED = ${stepWhereAligned}`);

  // ════════════════════════════════════════════════════════════════
  // PART B+C: SCORE + CONFIDENCE MEASUREMENT (all 44 snapshots)
  // ════════════════════════════════════════════════════════════════

  console.log('\n  ── PART B+C: SCORE + CONFIDENCE MEASUREMENT ──\n');

  const inProcessVariants: AblationVariant[] = ['FULL_MODEL', 'WITHOUT_AI', 'WITHOUT_FORM', 'WITHOUT_H2H', 'WITHOUT_STATS', 'WITHOUT_ANTITRAP', 'ODDS_ONLY', 'POISSON_ONLY'];
  const childProcessVariants: AblationVariant[] = ['WITHOUT_MOMENTUM'];

  // Collect results for each ablation variant
  const ablationData: Record<string, { scoreHome: number[]; scoreAway: number[]; confidence: number[]; probHome: number[]; probDraw: number[]; probAway: number[] }> = {};
  for (const v of [...inProcessVariants, ...childProcessVariants]) {
    ablationData[v] = { scoreHome: [], scoreAway: [], confidence: [], probHome: [], probDraw: [], probAway: [] };
  }

  let childProcessCount = 0;
  let childProcessFailures = 0;
  const childProcessTimes: number[] = [];

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const snap = row.feature_snapshot as StoredFeatureSnapshot;
    const home = row.home_team as string;
    const away = row.away_team as string;
    const league = row.league || 'Unknown';

    process.stdout.write(`  [${i + 1}/${rawData.length}] ${home} vs ${away} ... `);

    // In-process ablations
    for (const v of inProcessVariants) {
      try {
        const recon = reconstructMatchInputFromSnapshot(snap, home, away, league);
        const result = runAblation(recon, v);
        ablationData[v].scoreHome.push(result.scoreHome);
        ablationData[v].scoreAway.push(result.scoreAway);
        ablationData[v].confidence.push(result.confidence);
        ablationData[v].probHome.push(result.probHome);
        ablationData[v].probDraw.push(result.probDraw);
        ablationData[v].probAway.push(result.probAway);
      } catch (err) {
        // Push NaN to maintain array alignment
        ablationData[v].scoreHome.push(NaN);
        ablationData[v].scoreAway.push(NaN);
        ablationData[v].confidence.push(NaN);
        ablationData[v].probHome.push(NaN);
        ablationData[v].probDraw.push(NaN);
        ablationData[v].probAway.push(NaN);
      }
    }

    // Child-process ablation (WITHOUT_MOMENTUM)
    for (const v of childProcessVariants) {
      try {
        const recon = reconstructMatchInputFromSnapshot(snap, home, away, league);
        const cpStart = Date.now();
        const result = runAblation(recon, v);
        const cpTime = Date.now() - cpStart;
        childProcessTimes.push(cpTime);
        childProcessCount++;
        ablationData[v].scoreHome.push(result.scoreHome);
        ablationData[v].scoreAway.push(result.scoreAway);
        ablationData[v].confidence.push(result.confidence);
        ablationData[v].probHome.push(result.probHome);
        ablationData[v].probDraw.push(result.probDraw);
        ablationData[v].probAway.push(result.probAway);
      } catch (err) {
        childProcessFailures++;
        ablationData[v].scoreHome.push(NaN);
        ablationData[v].scoreAway.push(NaN);
        ablationData[v].confidence.push(NaN);
        ablationData[v].probHome.push(NaN);
        ablationData[v].probDraw.push(NaN);
        ablationData[v].probAway.push(NaN);
        console.log(`\n    ⚠ ${v} FAILED: ${(err as Error).message.substring(0, 200)}`);
      }
    }

    console.log('OK');
  }

  // ════════════════════════════════════════════════════════════════
  // REPORT: SCORE COMPARISON
  // ════════════════════════════════════════════════════════════════

  console.log('\n  ── SCORE PREDICTION COMPARISON ──\n');

  const compareVariants: AblationVariant[] = ['WITHOUT_FORM', 'WITHOUT_MOMENTUM', 'WITHOUT_H2H', 'WITHOUT_STATS', 'WITHOUT_ANTITRAP', 'ODDS_ONLY', 'POISSON_ONLY'];

  console.log('  ' + 'Variant'.padEnd(25) + 'Home goals'.padStart(15) + 'Away goals'.padStart(15) + 'Exact score'.padStart(15));
  console.log('  ' + '-'.repeat(70));

  const full = ablationData['FULL_MODEL'];
  console.log('  ' + 'FULL_MODEL'.padEnd(25) + `${full.scoreHome[0]}`.padStart(15) + `${full.scoreAway[0]}`.padStart(15) + 'N/A'.padStart(15));

  const scoreMetrics: any = {};

  for (const v of compareVariants) {
    const variant = ablationData[v];
    const n = full.scoreHome.length;

    let homeDiffSum = 0, homeMaxDiff = 0, homeChanged = 0;
    let awayDiffSum = 0, awayMaxDiff = 0, awayChanged = 0;
    let exactAgree = 0;

    for (let i = 0; i < n; i++) {
      if (isNaN(variant.scoreHome[i]) || isNaN(full.scoreHome[i])) continue;

      const hd = Math.abs(variant.scoreHome[i] - full.scoreHome[i]);
      homeDiffSum += hd;
      if (hd > homeMaxDiff) homeMaxDiff = hd;
      if (hd > 0) homeChanged++;

      const ad = Math.abs(variant.scoreAway[i] - full.scoreAway[i]);
      awayDiffSum += ad;
      if (ad > awayMaxDiff) awayMaxDiff = ad;
      if (ad > 0) awayChanged++;

      if (variant.scoreHome[i] === full.scoreHome[i] && variant.scoreAway[i] === full.scoreAway[i]) {
        exactAgree++;
      }
    }

    const validN = n; // all 44 should be valid
    const homeAvg = homeDiffSum / validN;
    const awayAvg = awayDiffSum / validN;
    const homePct = (homeChanged / validN * 100).toFixed(1);
    const awayPct = (awayChanged / validN * 100).toFixed(1);
    const exactPct = (exactAgree / validN * 100).toFixed(1);

    console.log('  ' + v.padEnd(25) +
      `${homeAvg.toFixed(3)} (${homePct}%)`.padStart(15) +
      `${awayAvg.toFixed(3)} (${awayPct}%)`.padStart(15) +
      `${exactPct}%`.padStart(15));

    scoreMetrics[v] = {
      home_mean_diff: homeAvg, home_max_diff: homeMaxDiff, home_changed: homeChanged, home_pct: homePct,
      away_mean_diff: awayAvg, away_max_diff: awayMaxDiff, away_changed: awayChanged, away_pct: awayPct,
      exact_score_agreement: exactAgree, exact_score_pct: exactPct,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // REPORT: CONFIDENCE COMPARISON
  // ════════════════════════════════════════════════════════════════

  console.log('\n  ── CONFIDENCE COMPARISON ──\n');

  console.log('  ' + 'Variant'.padEnd(25) + 'Mean diff'.padStart(12) + 'Max diff'.padStart(12) + 'Changed'.padStart(10) + '% Changed'.padStart(10));
  console.log('  ' + '-'.repeat(69));

  const confidenceMetrics: any = {};

  for (const v of compareVariants) {
    const variant = ablationData[v];
    const n = full.confidence.length;

    let diffSum = 0, maxDiff = 0, changed = 0;
    for (let i = 0; i < n; i++) {
      if (isNaN(variant.confidence[i]) || isNaN(full.confidence[i])) continue;
      const diff = Math.abs(variant.confidence[i] - full.confidence[i]);
      diffSum += diff;
      if (diff > maxDiff) maxDiff = diff;
      if (diff > 0) changed++;
    }

    const avgDiff = diffSum / n;
    const pctChanged = (changed / n * 100).toFixed(1);

    console.log('  ' + v.padEnd(25) +
      avgDiff.toFixed(2).padStart(12) +
      maxDiff.toFixed(0).padStart(12) +
      `${changed}`.padStart(10) +
      `${pctChanged}%`.padStart(10));

    confidenceMetrics[v] = {
      mean_diff: avgDiff, max_diff: maxDiff, changed, pct_changed: pctChanged,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // REPORT: 1X2 COMPARISON (re-confirm)
  // ════════════════════════════════════════════════════════════════

  console.log('\n  ── 1X2 COMPARISON (re-confirmed) ──\n');

  console.log('  ' + 'Variant'.padEnd(25) + 'Corr'.padStart(8) + 'Agree'.padStart(8) + 'AvgDiff'.padStart(10) + 'MaxDiff'.padStart(10));
  console.log('  ' + '-'.repeat(61));

  const oneX2Metrics: any = {};

  for (const v of compareVariants) {
    const variant = ablationData[v];
    const n = full.probHome.length;

    let agree = 0, diffSum = 0, maxDiff = 0;
    const fullH = [], varH = [];

    for (let i = 0; i < n; i++) {
      if (isNaN(variant.probHome[i]) || isNaN(full.probHome[i])) continue;
      if (variant.probHome[i] === full.probHome[i] && variant.probDraw[i] === full.probDraw[i] && variant.probAway[i] === full.probAway[i]) {
        agree++;
      }
      const diff = Math.abs(variant.probHome[i] - full.probHome[i]) +
        Math.abs(variant.probDraw[i] - full.probDraw[i]) +
        Math.abs(variant.probAway[i] - full.probAway[i]);
      diffSum += diff / 2;
      if (diff / 2 > maxDiff) maxDiff = diff / 2;
      fullH.push(full.probHome[i]);
      varH.push(variant.probHome[i]);
    }

    // Pearson correlation
    const meanF = fullH.reduce((s, v) => s + v, 0) / fullH.length;
    const meanV = varH.reduce((s, v) => s + v, 0) / varH.length;
    let sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < fullH.length; i++) {
      const dx = fullH[i] - meanF, dy = varH[i] - meanV;
      sumXY += dx * dy; sumX2 += dx * dx; sumY2 += dy * dy;
    }
    const corr = Math.sqrt(sumX2 * sumY2) > 0 ? sumXY / Math.sqrt(sumX2 * sumY2) : 0;

    const agreePct = (agree / n * 100).toFixed(1);
    const avgDiff = diffSum / n;

    console.log('  ' + v.padEnd(25) +
      corr.toFixed(3).padStart(8) +
      `${agreePct}%`.padStart(8) +
      avgDiff.toFixed(6).padStart(10) +
      maxDiff.toFixed(6).padStart(10));

    oneX2Metrics[v] = { correlation: corr, agreement: agree / n, avg_diff: avgDiff, max_diff: maxDiff };
  }

  // ════════════════════════════════════════════════════════════════
  // CHILD-PROCESS PERFORMANCE
  // ════════════════════════════════════════════════════════════════

  console.log('\n  ── WITHOUT_MOMENTUM CHILD-PROCESS ──');
  console.log(`  Spawned: ${childProcessCount}, Failures: ${childProcessFailures}`);
  if (childProcessTimes.length > 0) {
    const avgCp = childProcessTimes.reduce((s, t) => s + t, 0) / childProcessTimes.length;
    console.log(`  Avg: ${avgCp.toFixed(0)}ms, Min: ${Math.min(...childProcessTimes)}ms, Max: ${Math.max(...childProcessTimes)}ms`);
  }

  // ════════════════════════════════════════════════════════════════
  // WRITE OUTPUT
  // ════════════════════════════════════════════════════════════════

  const output = {
    generated_at: new Date().toISOString(),
    snapshots_analyzed: rawData.length,
    step_where_odds_alignment_is_established: stepWhereAligned,
    instrumentation_traces: traces,
    score_metrics: scoreMetrics,
    confidence_metrics: confidenceMetrics,
    one_x2_metrics: oneX2Metrics,
    child_process: {
      spawned: childProcessCount,
      failures: childProcessFailures,
      avg_ms: childProcessTimes.length > 0 ? childProcessTimes.reduce((s, t) => s + t, 0) / childProcessTimes.length : 0,
      min_ms: childProcessTimes.length > 0 ? Math.min(...childProcessTimes) : 0,
      max_ms: childProcessTimes.length > 0 ? Math.max(...childProcessTimes) : 0,
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n  Results written to: ${OUTPUT_FILE}`);
  console.log(`  File size: ${fs.statSync(OUTPUT_FILE).size} bytes`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
