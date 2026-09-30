// ============================================
// PHASE 5.3.36 — CANONICAL ELIGIBILITY CLI
// ============================================
//
// Purpose:
//   Provide a single Node/TypeScript entry point that exercises the
//   canonical `computeScientificEligible()` from `api/_lib/scientific-integrity.js`
//   on a batch of predictions, so the Python dataset builder
//   (`scripts/build-backtest-dataset.py`) can recompute D1 eligibility
//   WITHOUT duplicating the canonical 7-condition logic in Python.
//
// Architecture (Phase 5.3.36 §4 — Option B: shared JavaScript helper):
//   - The canonical function lives in ONE place: api/_lib/scientific-integrity.js
//   - This CLI imports and calls it directly — NO logic duplication
//   - Python invokes this CLI via `tsx scripts/canonical-eligibility-cli.ts`
//   - Input  (arg 1 = input JSON file path, OR stdin if no arg)
//   - Output (arg 2 = output JSON file path, OR stdout if no arg)
//
// Why file-based I/O:
//   For large datasets (497+ predictions), stdout pipe buffering can
//   truncate at ~64KB on Linux. Writing to a temp file is reliable.
//
// Each input prediction MUST contain (matching the DB column names,
// camelCased by the Python caller):
//   - id                            (string — UUID for traceability)
//   - featureSnapshot              (object | null — the JSONB column)
//   - completenessScore            (number | null)
//   - temporalSafetyScore         (number | null)
//   - tFeature                     (string | null — ISO 8601)
//   - aiResponseHash               (string | null)
//   - aiModel                      (string | null)
//   - aiCallStatus                 (string | null | undefined)
//
//   Plus the optional stored value for provenance preservation:
//   - scientificCollectionEligibleStored  (boolean | null)
//
// Each output prediction ADDS:
//   - scientificEligibleRecomputed         (boolean — canonical D1)
//   - eligibilityRuleVersion               (string — "D1_CANONICAL")
//
// For FINAL_BACKTEST_ELIGIBLE, the caller (Python) applies the
// ground-truth + valid-odds gate on top — this CLI does NOT make
// the final-backtest decision (it only computes scientific eligibility).
// ============================================

import * as fs from 'fs';
import { computeScientificEligible } from '../api/_lib/scientific-integrity.js';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface CanonicalInputPrediction {
  id: string;
  featureSnapshot: any | null;
  completenessScore: number | null;
  temporalSafetyScore: number | null;
  tFeature: string | null;
  aiResponseHash: string | null;
  aiModel: string | null;
  aiCallStatus: string | null | undefined;
  // Optional provenance
  scientificCollectionEligibleStored?: boolean | null;
}

interface CanonicalOutputPrediction extends CanonicalInputPrediction {
  scientificEligibleRecomputed: boolean;
  eligibilityRuleVersion: string;
}

interface CanonicalInput {
  predictions: CanonicalInputPrediction[];
}

interface CanonicalOutput {
  predictions: CanonicalOutputPrediction[];
  ruleVersion: string;
  totalInput: number;
  totalEligibleRecomputed: number;
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  // Read input
  let raw: string;
  if (inputPath) {
    raw = fs.readFileSync(inputPath, 'utf8');
  } else {
    raw = fs.readFileSync(0, 'utf8'); // 0 = stdin
  }

  let input: CanonicalInput;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    fs.writeFileSync(2, `[canonical-eligibility-cli] Failed to parse JSON input: ${(e as Error).message}\n`);
    process.exit(1);
  }

  if (!Array.isArray(input.predictions)) {
    fs.writeFileSync(2, `[canonical-eligibility-cli] Input must have 'predictions' array\n`);
    process.exit(1);
  }

  const RULE_VERSION = 'D1_CANONICAL';
  let eligibleCount = 0;

  const output: CanonicalOutput = {
    ruleVersion: RULE_VERSION,
    totalInput: input.predictions.length,
    totalEligibleRecomputed: 0,
    predictions: [],
  };

  for (const p of input.predictions) {
    // Call the canonical function with the 7 stored column values.
    // NULL semantics are preserved by the canonical function itself:
    //   - ai_model === 'math-v2' → false (F-MED-1 fabrication block)
    //   - ai_call_status != null && != 'PARSE_OK' → false (Phase 5.3.17.5)
    //   - feature_snapshot == null → false
    //   - completeness_score == null → false (null >= 0.5 is null/falsy)
    //   - temporal_safety_score == null → false
    //   - t_feature == null → false
    //   - ai_response_hash == null → false
    // IMPORTANT: we do NOT COALESCE NULLs — the canonical function
    // is called with the raw stored values to preserve its strict
    // NULL semantics.
    const eligibleRecomputed = computeScientificEligible(
      p.featureSnapshot ?? null,
      p.completenessScore ?? null,
      p.temporalSafetyScore ?? null,
      p.tFeature ?? null,
      p.aiResponseHash ?? null,
      p.aiModel ?? null,
      p.aiCallStatus ?? null,
    );

    if (eligibleRecomputed) eligibleCount++;

    output.predictions.push({
      ...p,
      scientificEligibleRecomputed: eligibleRecomputed,
      eligibilityRuleVersion: RULE_VERSION,
    });
  }

  output.totalEligibleRecomputed = eligibleCount;

  // Write output
  const outputJson = JSON.stringify(output);
  if (outputPath) {
    fs.writeFileSync(outputPath, outputJson);
    process.stderr.write(`[canonical-eligibility-cli] Wrote ${output.predictions.length} predictions (${eligibleCount} eligible) to ${outputPath}\n`);
  } else {
    process.stdout.write(outputJson);
  }
  process.exit(0);
}

main();

