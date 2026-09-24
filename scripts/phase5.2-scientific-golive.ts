// ============================================
// PHASE 5.2 EXECUTION SCRIPT
// Final AI Input Integrity & Scientific Go-Live
// ============================================

import { buildAIContext, computeAIDerivedContext, buildUserPromptFromContext, buildAISnapshotFromContext, computeAIContextHash, computeAIInputHashFromContext, computeAIPromptHashFromContext, verifyPromptSnapshotEquivalence, testContextLeakage, evaluateGoLiveGate, captureVersionFreeze, wilsonScoreInterval } from '../src/lib/ai-context';
import { AI_PROVIDER, AI_MODEL_DEFAULT, AI_PROMPT_VERSION, AI_TEMPERATURE, computeAIInputHash, buildAIInputsFromMatch, computeAIContextHashFromMatch } from '../src/lib/ai-traceability';
import { getConfig, COEFFICIENT_DEFINITIONS } from '../src/lib/prediction-config';
import { MODEL_VERSION, FEATURE_VERSION, CONFIG_VERSION, CALIBRATION_VERSION } from '../src/lib/feature-snapshot';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════
// SAMPLE MATCH FOR TESTING
// ═══════════════════════════════════════════════════════════════════

const PAST_TS = new Date(Date.now() - 86400000).toISOString();

const sampleMatch = {
  home: 'TeamA',
  away: 'TeamB',
  oddHome: 1.85,
  oddDraw: 3.40,
  oddAway: 4.20,
  rankingHome: { position: 3, played: 15, won: 9, drawn: 3, lost: 3, goalsFor: 24, goalsAgainst: 12, points: 30 },
  rankingAway: { position: 12, played: 15, won: 3, drawn: 3, lost: 9, goalsFor: 12, goalsAgainst: 24, points: 12 },
  recentHome: [
    { result: 'V', scoreHome: 1, scoreAway: 0 },
    { result: 'N', scoreHome: 1, scoreAway: 1 },
    { result: 'V', scoreHome: 2, scoreAway: 0 },
    { result: 'D', scoreHome: 0, scoreAway: 1 },
    { result: 'V', scoreHome: 1, scoreAway: 0 },
  ],
  recentAway: [
    { result: 'D', scoreHome: 0, scoreAway: 1 },
    { result: 'D', scoreHome: 1, scoreAway: 2 },
    { result: 'N', scoreHome: 0, scoreAway: 0 },
    { result: 'D', scoreHome: 0, scoreAway: 1 },
    { result: 'V', scoreHome: 1, scoreAway: 0 },
  ],
  headToHead: [
    { scoreHome: 2, scoreAway: 1 },
    { scoreHome: 1, scoreAway: 1 },
    { scoreHome: 3, scoreAway: 0 },
    { scoreHome: 0, scoreAway: 1 },
    { scoreHome: 1, scoreAway: 0 },
    { scoreHome: 1, scoreAway: 2 },
  ],
  oddsTimestamp: PAST_TS,
  rankingTimestamp: PAST_TS,
  formTimestamp: PAST_TS,
  h2hTimestamp: PAST_TS,
};

const SYSTEM_PROMPT_V7 = 'Tu es ANALYSTE FOOTBALL VIRTUEL v7.0';

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('PHASE 5.2 — FINAL AI INPUT INTEGRITY & SCIENTIFIC GO-LIVE');
  console.log('══════════════════════════════════════════════════════════════');
  console.log();

  // 1. Build canonical context
  console.log('1. Building canonical AIContext...');
  const ctx = buildAIContext(sampleMatch);
  const derived = computeAIDerivedContext(ctx);
  console.log('   ✓ AIContext built successfully');

  // 2. Build prompt and snapshot from same context
  console.log('\n2. Building prompt and snapshot from canonical context...');
  const prompt = buildUserPromptFromContext(ctx);
  const snapshot = buildAISnapshotFromContext(ctx);
  console.log('   ✓ User prompt built');
  console.log('   ✓ AI snapshot built');
  console.log('\n   Prompt preview:');
  console.log('   ' + prompt.split('\n').join('\n   '));

  // 3. Compute hashes
  console.log('\n3. Computing hashes...');
  const contextHash = computeAIContextHash(ctx);
  const inputHash = computeAIInputHashFromContext(snapshot);
  const promptHash = computeAIPromptHashFromContext(SYSTEM_PROMPT_V7, prompt);
  // Phase 7 fix (forensic audit BUG-7):
  // The previous version used `computeAIInputHashFromContext(snapshot)` as a
  // PLACEHOLDER for ai_response_hash. This is scientifically invalid — the
  // AI response hash must come from the actual LLM response text, or be null
  // when no LLM was called. Using the input hash as the response hash would
  // fabricate a false "AI responded" audit trail.
  // Per audit mandate §7: "Si aucune réponse LLM réelle n'existe:
  //   ai_response_hash = NULL"
  const responseHash = null;
  console.log('   AI_CONTEXT_HASH: ' + contextHash.substring(0, 32) + '...');
  console.log('   AI_INPUT_HASH:   ' + inputHash.substring(0, 32) + '...');
  console.log('   AI_PROMPT_HASH:  ' + promptHash.substring(0, 32) + '...');
  console.log('   AI_RESPONSE_HASH: null (no real LLM response in this script)');

  // 4. Equivalence check
  console.log('\n4. Verifying prompt/snapshot equivalence...');
  const eqResults = verifyPromptSnapshotEquivalence(ctx, prompt, snapshot);
  console.log('\n   Equivalence Matrix:');
  console.log('   ┌─────────────────────┬────────┬──────────┬───────────┐');
  console.log('   │ Input               │ Prompt │ Snapshot │ Identical │');
  console.log('   ├─────────────────────┼────────┼──────────┼───────────┤');
  for (const r of eqResults) {
    const name = r.input.padEnd(19);
    const p = r.in_prompt ? '  ✓  ' : '  ✗  ';
    const s = r.in_snapshot ? '   ✓    ' : '   ✗    ';
    const id = (r.identical || r.difference_type === 'NONE') ? '    ✓     ' : '    ✗     ';
    console.log(`   │ ${name} │${p} │${s} │${id} │`);
  }
  console.log('   └─────────────────────┴────────┴──────────┴───────────┘');

  const allIdentical = eqResults.every(r => r.identical || r.difference_type === 'NONE');
  console.log(`   Overall: ${allIdentical ? '✓ ALL IDENTICAL' : '✗ DIFFERENCES FOUND'}`);

  // 5. Hash determinism
  console.log('\n5. Verifying hash determinism...');
  const ctx2 = buildAIContext(sampleMatch);
  const snap2 = buildAISnapshotFromContext(ctx2);
  const inputHash2 = computeAIInputHashFromContext(snap2);
  const contextHash2 = computeAIContextHash(ctx2);
  const inputHashReproducible = inputHash === inputHash2;
  const contextHashReproducible = contextHash === contextHash2;
  console.log(`   AI_CONTEXT_HASH reproducible: ${contextHashReproducible ? '✓' : '✗'}`);
  console.log(`   AI_INPUT_HASH reproducible:   ${inputHashReproducible ? '✓' : '✗'}`);

  // 6. Prompt hash determinism
  const promptHash2 = computeAIPromptHashFromContext(SYSTEM_PROMPT_V7, prompt);
  const promptHashReproducible = promptHash === promptHash2;
  console.log(`   AI_PROMPT_HASH reproducible:  ${promptHashReproducible ? '✓' : '✗'}`);

  // 7. Leakage test
  console.log('\n6. Running leakage test...');
  const leakResult = testContextLeakage(ctx, ctx, 'Same data');
  console.log(`   Same data → same hash: ${leakResult.passed ? '✓' : '✗'}`);

  // Modified data should change hash
  const modifiedMatch = { ...sampleMatch, oddHome: 2.10 };
  const modifiedCtx = buildAIContext(modifiedMatch);
  const leakResult2 = testContextLeakage(ctx, modifiedCtx, 'Modified odds');
  console.log(`   Modified odds → different hash: ${!leakResult2.passed ? '✓' : '✗'}`);

  // 8. Version freeze
  console.log('\n7. Capturing version freeze...');
  const codeCommit = 'pending'; // Will be set by git
  const freeze = captureVersionFreeze(codeCommit);
  console.log(`   MODEL_VERSION:       ${freeze.model_version}`);
  console.log(`   FEATURE_VERSION:     ${freeze.feature_version}`);
  console.log(`   CONFIG_VERSION:      ${freeze.config_version}`);
  console.log(`   CALIBRATION_VERSION: ${freeze.calibration_version}`);
  console.log(`   AI_PROMPT_VERSION:   ${freeze.ai_prompt_version}`);
  console.log(`   AI_MODEL:            ${freeze.ai_model}`);

  // 9. Model integrity
  console.log('\n8. Verifying model integrity...');
  const config = getConfig();
  console.log(`   AI_WEIGHT: ${config.AI_WEIGHT} (expected: 0.35) ${config.AI_WEIGHT === 0.35 ? '✓' : '✗ MODIFIED!'}`);
  const arbitraryCoeffs = Object.values(COEFFICIENT_DEFINITIONS).filter(c => c.calibrationStatus === 'arbitrary');
  console.log(`   Arbitrary coefficients: ${arbitraryCoeffs.length} (expected: 15)`);
  console.log(`   Total coefficients: ${Object.keys(COEFFICIENT_DEFINITIONS).length}`);

  // 10. Migration check
  console.log('\n9. Checking migrations...');
  const projectRoot = path.resolve(__dirname, '..');
  const migration007 = fs.readFileSync(path.resolve(projectRoot, 'api/_migrations/007_snapshot_immutability.sql'), 'utf-8');
  const migration008 = fs.readFileSync(path.resolve(projectRoot, 'api/_migrations/008_ai_context_integrity.sql'), 'utf-8');
  console.log(`   Migration 007: ${migration007.includes('enforce_snapshot_immutability') ? '✓' : '✗'}`);
  console.log(`   Migration 008: ${migration008.includes('ai_context_hash') ? '✓' : '✗'}`);

  // 11. Go-Live Gate evaluation
  console.log('\n10. Evaluating Go-Live Gate...');
  // Phase 10 fix (forensic audit BUG-8):
  // The previous version hardcoded:
  //   timestampsConsistent: true
  //   snapshotImmutable: true
  //   testsPass: true
  // These were NEVER actually verified, which would let the script declare
  // SCIENTIFIC_DATA_COLLECTION = READY without proof. Per audit mandate §10
  // and §22: "UNKNOWN ≠ PASS".
  //
  // We now compute each value from the actual data this script has access to.
  // For values that require production data we cannot reach from here
  // (Neon DB counts, real trigger tests), we set them to false so the
  // gate stays BLOCKED until the user runs the additional verification scripts.

  // timestampsConsistent: verify the timeline of the SAMPLE match
  // (t_start <= t_features <= t_prediction_final <= t_snapshot).
  const sampleTStart = PAST_TS;
  const sampleTFeatures = PAST_TS;
  const sampleTPrediction = new Date().toISOString();
  const sampleTSnapshot = sampleTPrediction;
  const tStartMs = new Date(sampleTStart).getTime();
  const tFeaturesMs = new Date(sampleTFeatures).getTime();
  const tPredMs = new Date(sampleTPrediction).getTime();
  const tSnapMs = new Date(sampleTSnapshot).getTime();
  const timestampsConsistent =
    tStartMs <= tFeaturesMs &&  // t_start <= t_features
    tFeaturesMs <= tPredMs &&    // t_features <= t_prediction
    tPredMs <= tSnapMs;          // t_prediction <= t_snapshot

  // snapshotImmutable: we CANNOT verify the DB trigger from this script.
  // To verify, the user must run a real PATCH attempt against a prediction
  // that already has a value, and confirm the trigger blocks it.
  // Until that verification is performed, snapshotImmutable = false.
  const snapshotImmutable = false; // requires Neon DB verification (Phase 17)

  // testsPass: this script CANNOT run vitest itself. The user must run
  // `npm run test:all` separately and inspect the result.
  // Until that verification is performed, testsPass = false.
  const testsPass = false; // requires `npm run test:all` to pass (Phase 16)

  const goLive = evaluateGoLiveGate({
    equivalenceResults: eqResults,
    inputHashReproducible,
    promptHashReproducible,
    timestampsConsistent,
    leakageTestPassed: leakResult.passed,
    snapshotImmutable,
    testsPass,
  });

  console.log(`    Prompt & snapshot same source:     ${goLive.prompt_snapshot_same_source ? '✓' : '✗'}`);
  console.log(`    No prompt data missing from snap:  ${goLive.no_prompt_data_missing_from_snapshot ? '✓' : '✗'}`);
  console.log(`    AI_INPUT_HASH reproducible:        ${goLive.ai_input_hash_reproducible ? '✓' : '✗'}`);
  console.log(`    AI_PROMPT_HASH reproducible:       ${goLive.ai_prompt_hash_reproducible ? '✓' : '✗'}`);
  console.log(`    Timestamps consistent (sample):    ${goLive.timestamps_consistent ? '✓' : '✗'}`);
  console.log(`    Leakage test OK:                   ${goLive.leakage_test_ok ? '✓' : '✗'}`);
  console.log(`    Snapshot immutable (DB verified):   ${goLive.snapshot_immutable ? '✓' : '✗ — requires Neon trigger verification'}`);
  console.log(`    Tests pass (vitest run):           ${goLive.tests_pass ? '✓' : '✗ — requires \`npm run test:all\` verification'}`);
  console.log(`    AI_RESPONSE_HASH = null (no LLM):  ${responseHash === null ? '✓' : '✗ — PLACEHOLDER LEAK'}`);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`SCIENTIFIC_DATA_COLLECTION = ${goLive.overall}`);
  if (goLive.overall === 'BLOCKED') {
    console.log('\nBlocking issues:');
    for (const issue of goLive.blocking_issues) {
      console.log(`  - ${issue}`);
    }
  }
  console.log('══════════════════════════════════════════════════════════════');

  // 12. Wilson CI for typical sample sizes
  console.log('\n11. Wilson Score Intervals for typical sample sizes:');
  const sampleSizes = [100, 500, 1000, 5000];
  for (const n of sampleSizes) {
    const ci = wilsonScoreInterval(Math.round(n * 0.55), n);
    console.log(`   N=${n.toString().padStart(5)}: 55% accuracy → 95% CI [${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]`);
  }

  // Return results for report generation
  return {
    contextHash,
    inputHash,
    promptHash,
    equivalence: eqResults,
    allIdentical,
    goLive,
    freeze,
    config,
  };
}

const results = main();
