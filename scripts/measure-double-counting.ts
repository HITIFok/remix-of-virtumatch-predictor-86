// ============================================
// PHASE 5.3.22 — DOUBLE COUNTING MEASUREMENT
// Executes measureFormMomentumDoubleCounting + measureAIOddsDoubleCounting
// on real Neon snapshots via reconstruction + ablation.
//
// READ-ONLY: no network, no Groq, no DB writes, no future data.
// ============================================

import * as fs from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';
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
import {
  measureFormMomentumDoubleCounting,
  measureAIOddsDoubleCounting,
  type PredictionResult,
  type DoubleCountingResult,
} from '../src/lib/double-counting-measure';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function ablationToPredictionResult(a: AblationResult): PredictionResult {
  return {
    prediction: a.prediction,
    prob_home: a.probHome,
    prob_draw: a.probDraw,
    prob_away: a.probAway,
    confidence: a.confidence,
  };
}

/**
 * Run WITHOUT_FORM_AND_MOMENTUM: filter form entries + child-process with MOMENTUM_SCALE=100000.
 * This is a COMBINED ablation not in the standard ABLATION_MATRIX.
 */
function runWithoutFormAndMomentum(
  snapshot: StoredFeatureSnapshot,
  homeTeam: string,
  awayTeam: string,
  league: string,
): AblationResult {
  const recon = reconstructMatchInputFromSnapshot(snapshot, homeTeam, awayTeam, league);

  // Filter: remove form entries (keep only H2H)
  const filteredResults = recon.historicalResults.filter(r =>
    (r.home === recon.match.home && r.away === recon.match.away)  // H2H entries only
  );

  // Serialize teamStats for child process
  const teamStatsArray = Array.from(recon.teamStats.entries()).map(([name, ts]) => ({ ...ts, name }));

  const input = {
    home: recon.match.home,
    away: recon.match.away,
    league: recon.match.league,
    oddHome: recon.match.oddHome,
    oddDraw: recon.match.oddDraw,
    oddAway: recon.match.oddAway,
    teamStatsArray,
    historicalResults: filteredResults,
  };

  const tmpDir = '/tmp';
  const tmpInput = path.join(tmpDir, `dc-wofm-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const tmpOutput = path.join(tmpDir, `dc-wofm-out-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmpInput, JSON.stringify(input));

  try {
    const envObj: Record<string, string> = {
      ...process.env as Record<string, string>,
      VIRTUMATCH_COEF_MOMENTUM_SCALE: '100000',
    };

    // Phase 5.3.22.1 FIX: use local tsx binary + process.cwd() (not __dirname)
    const repoRoot = process.cwd();
    const helperScript = path.join(repoRoot, 'scripts', 'backtest-ablation-helper.ts');
    const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
    const tsxCmd = fs.existsSync(tsxBin) ? tsxBin : 'npx tsx';

    execSync(`${tsxCmd} ${helperScript} ${tmpInput} ${tmpOutput}`, {
      cwd: repoRoot,
      timeout: 30000,
      stdio: 'pipe',
      env: envObj,
      encoding: 'utf-8' as const,
    });

    if (!fs.existsSync(tmpOutput)) {
      throw new Error('WITHOUT_FORM_AND_MOMENTUM: child process completed but output file not created');
    }

    const result = JSON.parse(fs.readFileSync(tmpOutput, 'utf8'));
    const prediction: '1' | 'X' | '2' = result.predicted as '1' | 'X' | '2';

    return {
      variant: 'WITHOUT_FORM_AND_MOMENTUM' as AblationVariant,
      probHome: result.probHome,
      probDraw: result.probDraw,
      probAway: result.probAway,
      prediction,
      confidence: result.confidence || 0,
      scoreHome: result.scoreHome || 0,
      scoreAway: result.scoreAway || 0,
      warnings: recon.warnings,
    };
  } catch (err) {
    // Phase 5.3.22.1 FIX: NO SILENT FALLBACK — throw loudly
    throw new Error(
      `ABLATION_EXECUTION_FAILED: WITHOUT_FORM_AND_MOMENTUM child process failed.\n` +
      `Error: ${(err as Error).message}\n` +
      `NO FALLBACK — env override ablation cannot fall back to in-process execution.`
    );
  } finally {
    try { fs.unlinkSync(tmpInput); } catch {}
    try { fs.unlinkSync(tmpOutput); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

const SNAPSHOTS_FILE = '/home/z/my-project/download/snapshots-for-measurement.json';
const OUTPUT_FILE = '/home/z/my-project/download/double-counting-results.json';

async function main() {
  console.log('═'.repeat(78));
  console.log('  PHASE 5.3.22 — DOUBLE COUNTING MEASUREMENT');
  console.log('═'.repeat(78));

  // Load snapshots
  const rawData = JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8'));
  console.log(`\n  Loaded ${rawData.length} snapshots from ${SNAPSHOTS_FILE}`);

  // For each snapshot, run ablations and collect PredictionResult arrays
  const fullModel: PredictionResult[] = [];
  const withoutForm: PredictionResult[] = [];
  const withoutMomentum: PredictionResult[] = [];
  const withoutFormAndMomentum: PredictionResult[] = [];
  const withoutAi: PredictionResult[] = [];
  const oddsOnly: PredictionResult[] = [];
  const withoutH2H: PredictionResult[] = [];
  const withoutStats: PredictionResult[] = [];
  const poissonOnly: PredictionResult[] = [];

  let childProcessCount = 0;
  const childProcessTimes: number[] = [];

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const snapshot = row.feature_snapshot as StoredFeatureSnapshot;
    const home = row.home_team as string;
    const away = row.away_team as string;
    const league = row.league || 'Unknown';

    process.stdout.write(`  [${i + 1}/${rawData.length}] ${home} vs ${away} ... `);

    try {
      // In-process ablations (fast)
      const recon = reconstructMatchInputFromSnapshot(snapshot, home, away, league);

      // FULL_MODEL (= WITHOUT_AI in backtest — AI not available)
      const fullResult = runAblation(recon, 'FULL_MODEL');
      fullModel.push(ablationToPredictionResult(fullResult));

      // WITHOUT_AI (= FULL_MODEL in backtest)
      const noAiResult = runAblation(recon, 'WITHOUT_AI');
      withoutAi.push(ablationToPredictionResult(noAiResult));

      // WITHOUT_FORM
      const noFormResult = runAblation(recon, 'WITHOUT_FORM');
      withoutForm.push(ablationToPredictionResult(noFormResult));

      // WITHOUT_H2H
      const noH2HResult = runAblation(recon, 'WITHOUT_H2H');
      withoutH2H.push(ablationToPredictionResult(noH2HResult));

      // WITHOUT_STATS
      const noStatsResult = runAblation(recon, 'WITHOUT_STATS');
      withoutStats.push(ablationToPredictionResult(noStatsResult));

      // ODDS_ONLY
      const oddsResult = runAblation(recon, 'ODDS_ONLY');
      oddsOnly.push(ablationToPredictionResult(oddsResult));

      // POISSON_ONLY
      const poissonResult = runAblation(recon, 'POISSON_ONLY');
      poissonOnly.push(ablationToPredictionResult(poissonResult));

      // Child-process ablations (slow)
      const cpStart = Date.now();
      const noMomResult = runAblation(recon, 'WITHOUT_MOMENTUM');
      withoutMomentum.push(ablationToPredictionResult(noMomResult));
      childProcessCount++;
      const cpTime1 = Date.now() - cpStart;
      childProcessTimes.push(cpTime1);

      const cpStart2 = Date.now();
      const noFormMomResult = runWithoutFormAndMomentum(snapshot, home, away, league);
      withoutFormAndMomentum.push(ablationToPredictionResult(noFormMomResult));
      childProcessCount++;
      const cpTime2 = Date.now() - cpStart2;
      childProcessTimes.push(cpTime2);

      console.log(`OK (${cpTime1 + cpTime2}ms for child processes)`);
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`);
      // Push default values to maintain array alignment
      const defaultPR: PredictionResult = { prediction: 'X', prob_home: 1/3, prob_draw: 1/3, prob_away: 1/3, confidence: 33 };
      fullModel.push(defaultPR);
      withoutForm.push(defaultPR);
      withoutMomentum.push(defaultPR);
      withoutFormAndMomentum.push(defaultPR);
      withoutAi.push(defaultPR);
      oddsOnly.push(defaultPR);
      withoutH2H.push(defaultPR);
      withoutStats.push(defaultPR);
      poissonOnly.push(defaultPR);
    }
  }

  console.log(`\n  ── MEASUREMENT ──`);

  // ── 1. FORM / MOMENTUM double counting ──
  console.log('\n  [1] measureFormMomentumDoubleCounting()');
  const formMomentumResult = measureFormMomentumDoubleCounting(
    fullModel, withoutForm, withoutMomentum, withoutFormAndMomentum,
  );
  console.log(`  Conclusion: ${formMomentumResult.conclusion}`);
  for (const r of formMomentumResult.results) {
    console.log(`    ${r.variant}: correlation=${r.correlation.toFixed(3)}, agreement=${(r.agreement_rate * 100).toFixed(1)}%, avg_diff=${r.avg_prob_diff.toFixed(4)}, max_diff=${r.max_prob_diff.toFixed(4)}`);
  }

  // ── 2. AI / ODDS double counting ──
  console.log('\n  [2] measureAIOddsDoubleCounting()');
  // AI_ONLY = null (AI response not stored — NOT_MEASURABLE)
  const aiOddsResult = measureAIOddsDoubleCounting(
    fullModel, withoutAi, oddsOnly, null,  // aiOnly = null
  );
  console.log(`  Conclusion: ${aiOddsResult.conclusion}`);
  for (const r of aiOddsResult.results) {
    console.log(`    ${r.variant}: correlation=${r.correlation.toFixed(3)}, agreement=${(r.agreement_rate * 100).toFixed(1)}%, avg_diff=${r.avg_prob_diff.toFixed(4)}, max_diff=${r.max_prob_diff.toFixed(4)}`);
  }
  console.log(`  AI_ONLY: NULL (ai_response not stored → AI_DOUBLE_COUNTING = NOT_MEASURABLE)`);

  // ── 3. Additional measurements (ODDS, H2H, STATS) ──
  console.log('\n  [3] Additional ablation comparisons');

  // ODDS divergence: FULL vs ODDS_ONLY
  const fullVsOdds: DoubleCountingResult = measureAIOddsDoubleCounting(fullModel, withoutAi, oddsOnly, null).results
    .find(r => r.variant === 'FULL vs ODDS_ONLY')!;
  console.log(`    FULL vs ODDS_ONLY: correlation=${fullVsOdds.correlation.toFixed(3)}, avg_diff=${fullVsOdds.avg_prob_diff.toFixed(4)}`);

  // H2H contribution: FULL vs WITHOUT_H2H
  const nH2H = Math.min(fullModel.length, withoutH2H.length);
  let h2hAgreement = 0, h2hTotalDiff = 0;
  for (let i = 0; i < nH2H; i++) {
    if (fullModel[i].prediction === withoutH2H[i].prediction) h2hAgreement++;
    h2hTotalDiff += Math.abs(fullModel[i].prob_home - withoutH2H[i].prob_home);
  }
  console.log(`    FULL vs WITHOUT_H2H: agreement=${(h2hAgreement / nH2H * 100).toFixed(1)}%, avg_diff=${(h2hTotalDiff / nH2H).toFixed(4)}`);

  // STATS contribution: FULL vs WITHOUT_STATS
  let statsAgreement = 0, statsTotalDiff = 0;
  for (let i = 0; i < nH2H; i++) {
    if (fullModel[i].prediction === withoutStats[i].prediction) statsAgreement++;
    statsTotalDiff += Math.abs(fullModel[i].prob_home - withoutStats[i].prob_home);
  }
  console.log(`    FULL vs WITHOUT_STATS: agreement=${(statsAgreement / nH2H * 100).toFixed(1)}%, avg_diff=${(statsTotalDiff / nH2H).toFixed(4)}`);

  // POISSON_ONLY vs ODDS_ONLY (mathematical distinction check)
  let poissonAgreement = 0, poissonTotalDiff = 0;
  for (let i = 0; i < nH2H; i++) {
    if (poissonOnly[i].prediction === oddsOnly[i].prediction) poissonAgreement++;
    poissonTotalDiff += Math.abs(poissonOnly[i].prob_home - oddsOnly[i].prob_home);
  }
  console.log(`    POISSON_ONLY vs ODDS_ONLY: agreement=${(poissonAgreement / nH2H * 100).toFixed(1)}%, avg_diff=${(poissonTotalDiff / nH2H).toFixed(4)}`);

  // ── Child-process performance ──
  console.log('\n  ── WITHOUT_MOMENTUM CHILD-PROCESS PERFORMANCE ──');
  const avgCpTime = childProcessTimes.reduce((s, t) => s + t, 0) / childProcessTimes.length;
  const minCpTime = Math.min(...childProcessTimes);
  const maxCpTime = Math.max(...childProcessTimes);
  console.log(`  Child processes spawned: ${childProcessCount}`);
  console.log(`  Average time: ${avgCpTime.toFixed(0)}ms`);
  console.log(`  Min: ${minCpTime}ms, Max: ${maxCpTime}ms`);

  // ── Write output ──
  const output = {
    generated_at: new Date().toISOString(),
    snapshots_analyzed: rawData.length,
    form_momentum: {
      correlation: formMomentumResult.form_momentum_correlation,
      conclusion: formMomentumResult.conclusion,
      results: formMomentumResult.results.map(r => ({
        variant: r.variant,
        description: r.description,
        predictions_compared: r.predictions_compared,
        correlation: r.correlation,
        agreement_rate: r.agreement_rate,
        divergence_rate: r.divergence_rate,
        avg_prob_diff: r.avg_prob_diff,
        max_prob_diff: r.max_prob_diff,
        significant: r.significant,
      })),
    },
    ai_odds: {
      conclusion: aiOddsResult.conclusion,
      ai_only: 'NOT_MEASURABLE (AI response not stored)',
      results: aiOddsResult.results.map(r => ({
        variant: r.variant,
        description: r.description,
        predictions_compared: r.predictions_compared,
        correlation: r.correlation,
        agreement_rate: r.agreement_rate,
        divergence_rate: r.divergence_rate,
        avg_prob_diff: r.avg_prob_diff,
        max_prob_diff: r.max_prob_diff,
        significant: r.significant,
      })),
    },
    additional_measurements: {
      full_vs_without_h2h: { agreement: h2hAgreement / nH2H, avg_diff: h2hTotalDiff / nH2H },
      full_vs_without_stats: { agreement: statsAgreement / nH2H, avg_diff: statsTotalDiff / nH2H },
      poisson_only_vs_odds_only: { agreement: poissonAgreement / nH2H, avg_diff: poissonTotalDiff / nH2H },
    },
    child_process_performance: {
      count: childProcessCount,
      avg_ms: avgCpTime,
      min_ms: minCpTime,
      max_ms: maxCpTime,
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
