// ============================================
// UNIT TESTS — scripts/recompute-ai-hashes.ts
// Phase 5.3.10 — Hash recomputation tool tests
// ============================================
//
// These tests verify the helper functions WITHOUT requiring a Neon connection.
// They cover:
//   - extractSystemPrompt() — string extraction from analyze-match.js
//   - rebuildAIContext() — AIContext reconstruction from feature_snapshot
//   - recomputeHashesForPrediction() — hash comparison logic
//   - NOT_RECOMPUTABLE handling for AI_RESPONSE_HASH
//
// They do NOT test the Neon DB connection (that requires a live DB).

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  extractSystemPrompt,
  readSystemPromptFromFile,
  rebuildAIContext,
  recomputeHashesForPrediction,
} from '../../scripts/recompute-ai-hashes';
import {
  computeAIContextHash,
  computeAIInputHashFromContext,
} from '../../src/lib/ai-context';

// ═══════════════════════════════════════════════════════════════════
// TEST 1: extractSystemPrompt — extraction from analyze-match.js source
// ═══════════════════════════════════════════════════════════════════

describe('recompute-ai-hashes — extractSystemPrompt', () => {
  it('extracts the SYSTEM_PROMPT from the real analyze-match.js file', () => {
    const analyzeMatchPath = path.resolve(__dirname, '../../api/analyze-match.js');
    const source = fs.readFileSync(analyzeMatchPath, 'utf-8');
    const prompt = extractSystemPrompt(source);

    expect(prompt).not.toBeNull();
    expect(prompt!.length).toBeGreaterThan(500);  // The SYSTEM_PROMPT is ~3KB
    expect(prompt).toContain('Tu es ANALYSTE FOOTBALL VIRTUEL v7.0');
    expect(prompt).toContain('Football virtuel UNIQUEMENT');
    // The prompt ends with the JSON output format spec
    expect(prompt).toContain('JSON SANS MARKDOWN');
  });

  it('returns null when the source has no SYSTEM_PROMPT declaration', () => {
    const source = `
      const foo = 'bar';
      // no system prompt here
    `;
    const prompt = extractSystemPrompt(source);
    expect(prompt).toBeNull();
  });

  it('returns null when the source has a partial declaration without closing backtick', () => {
    const source = `const SYSTEM_PROMPT = \`incomplete prompt without end`;
    const prompt = extractSystemPrompt(source);
    expect(prompt).toBeNull();
  });

  it('handles template literal with backticks inside escaped characters', () => {
    const source = "const SYSTEM_PROMPT = `Hello \\`world\\``;\n";
    const prompt = extractSystemPrompt(source);
    // The regex is non-greedy, so it captures up to the first unescaped backtick.
    // For audit purposes, the real SYSTEM_PROMPT has no escaped backticks inside.
    expect(prompt).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2: readSystemPromptFromFile — reads from real file
// ═══════════════════════════════════════════════════════════════════

describe('recompute-ai-hashes — readSystemPromptFromFile', () => {
  it('reads the SYSTEM_PROMPT from the real analyze-match.js', () => {
    const prompt = readSystemPromptFromFile();
    expect(prompt).not.toBeNull();
    expect(prompt!.length).toBeGreaterThan(500);
    expect(prompt).toContain('ANALYSTE FOOTBALL VIRTUEL');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3: rebuildAIContext — reconstruction from feature_snapshot
// ═══════════════════════════════════════════════════════════════════

describe('recompute-ai-hashes — rebuildAIContext', () => {
  it('rebuilds a valid AIContext when all fields are present', () => {
    const featureSnapshot = {
      odds: {
        home: 1.85, draw: 3.40, away: 4.20,
        source_timestamp: '2026-09-24T10:00:00Z',
      },
      standings: {
        home: { position: 1, played: 10, won: 7, drawn: 2, lost: 1, goalsFor: 15, goalsAgainst: 5, points: 23 },
        away: { position: 5, played: 10, won: 4, drawn: 3, lost: 3, goalsFor: 12, goalsAgainst: 10, points: 15 },
        source_timestamp: '2026-09-24T09:00:00Z',
      },
      form: {
        home: [{ result: 'V', scoreHome: 2, scoreAway: 0 }],
        away: [{ result: 'D', scoreHome: 0, scoreAway: 1 }],
        source_timestamp: '2026-09-24T09:30:00Z',
      },
      h2h: {
        matches: [{ scoreHome: 2, scoreAway: 1 }],
        source_timestamp: '2026-09-24T09:45:00Z',
      },
      source_timestamps: {
        odds: '2026-09-24T10:00:00Z',
        ranking: '2026-09-24T09:00:00Z',
        form: '2026-09-24T09:30:00Z',
        h2h: '2026-09-24T09:45:00Z',
      },
      ai_snapshot: {},
      match_index: 1,
      schema_version: '3.0',
    };

    const ctx = rebuildAIContext(featureSnapshot, 'TeamA', 'TeamB');
    expect(ctx).not.toBeNull();
    expect(ctx!.home).toBe('TeamA');
    expect(ctx!.away).toBe('TeamB');
    expect(ctx!.odds.home).toBe(1.85);
    expect(ctx!.odds.source_timestamp).toBe('2026-09-24T10:00:00Z');
    expect(ctx!.standings.home.position).toBe(1);
    expect(ctx!.h2h.matches.length).toBe(1);
    expect(ctx!.match_index).toBe(1);
    expect(ctx!.source_timestamps.odds).toBe('2026-09-24T10:00:00Z');
  });

  it('returns null when feature_snapshot is null', () => {
    const ctx = rebuildAIContext(null, 'TeamA', 'TeamB');
    expect(ctx).toBeNull();
  });

  it('returns null when feature_snapshot is missing required keys', () => {
    const incomplete = { odds: { home: 1.85, draw: 3.40, away: 4.20, source_timestamp: null } };
    // Missing standings, form, h2h, source_timestamps
    const ctx = rebuildAIContext(incomplete, 'TeamA', 'TeamB');
    expect(ctx).toBeNull();
  });

  it('handles nullable fields within feature_snapshot (form.home can be null)', () => {
    const featureSnapshot = {
      odds: { home: 1.85, draw: 3.40, away: 4.20, source_timestamp: null },
      standings: { home: null, away: null, source_timestamp: null },
      form: { home: null, away: null, source_timestamp: null },
      h2h: { matches: null, source_timestamp: null },
      source_timestamps: { odds: null, ranking: null, form: null, h2h: null },
      ai_snapshot: null,
      match_index: 1,
      schema_version: '3.0',
    };

    const ctx = rebuildAIContext(featureSnapshot, 'TeamA', 'TeamB');
    expect(ctx).not.toBeNull();
    expect(ctx!.standings.home).toBeNull();
    expect(ctx!.form.home).toBeNull();
    expect(ctx!.h2h.matches).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4: recomputeHashesForPrediction — full hash recomputation logic
// ═══════════════════════════════════════════════════════════════════

describe('recompute-ai-hashes — recomputeHashesForPrediction', () => {
  // Sample prediction with a complete feature_snapshot
  const samplePrediction = {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    home_team: 'TeamA',
    away_team: 'TeamB',
    feature_snapshot: {
      odds: {
        home: 1.85, draw: 3.40, away: 4.20,
        source_timestamp: '2026-09-24T10:00:00Z',
      },
      standings: {
        home: { position: 1, played: 10, won: 7, drawn: 2, lost: 1, goalsFor: 15, goalsAgainst: 5, points: 23 },
        away: { position: 5, played: 10, won: 4, drawn: 3, lost: 3, goalsFor: 12, goalsAgainst: 10, points: 15 },
        source_timestamp: '2026-09-24T09:00:00Z',
      },
      form: {
        home: [{ result: 'V', scoreHome: 2, scoreAway: 0 }],
        away: [{ result: 'D', scoreHome: 0, scoreAway: 1 }],
        source_timestamp: '2026-09-24T09:30:00Z',
      },
      h2h: {
        matches: [{ scoreHome: 2, scoreAway: 1 }],
        source_timestamp: '2026-09-24T09:45:00Z',
      },
      source_timestamps: {
        odds: '2026-09-24T10:00:00Z',
        ranking: '2026-09-24T09:00:00Z',
        form: '2026-09-24T09:30:00Z',
        h2h: '2026-09-24T09:45:00Z',
      },
      ai_snapshot: {
        odds: {
          home: { name: 'odds_home', value: 1.85, source: 'bookmaker/scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
          draw: { name: 'odds_draw', value: 3.40, source: 'bookmaker/scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
          away: { name: 'odds_away', value: 4.20, source: 'bookmaker/scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
          implied_home: { name: 'odds_implied_home', value: 54, source: 'calculated_from_odds', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
          implied_draw: { name: 'odds_implied_draw', value: 29, source: 'calculated_from_odds', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
          implied_away: { name: 'odds_implied_away', value: 24, source: 'calculated_from_odds', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
        },
        standings_home: { name: 'standings_home', value: '#1 10j 7V2N1D 15-5 23p att:1.5 def:0.5', source: 'ranking_table', source_timestamp: '2026-09-24T09:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
        standings_away: { name: 'standings_away', value: '#5 10j 4V3N3D 12-10 15p att:1.2 def:1.0', source: 'ranking_table', source_timestamp: '2026-09-24T09:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
        form_home: { name: 'form_home', value: 'V2-0', source: 'historical_matches', source_timestamp: '2026-09-24T09:30:00Z', version: '1.0.0', provenance: 'RECORDED' },
        form_away: { name: 'form_away', value: 'D0-1', source: 'historical_matches', source_timestamp: '2026-09-24T09:30:00Z', version: '1.0.0', provenance: 'RECORDED' },
        h2h: { name: 'h2h', value: '1V0N1D avg:3.0bm', source: 'historical_matches', source_timestamp: '2026-09-24T09:45:00Z', version: '1.0.0', provenance: 'RECORDED' },
        other: [],
      },
      match_index: 1,
      schema_version: '3.0',
    },
    ai_context_hash: 'placeholder-stored-context-hash',
    ai_input_hash: 'placeholder-stored-input-hash',
    ai_prompt_hash: 'placeholder-stored-prompt-hash',
    ai_response_hash: null,
    ai_trace: {
      hashes: {
        ai_context_hash: 'placeholder-stored-context-hash',
        ai_input_hash: 'placeholder-stored-input-hash',
        ai_prompt_hash: 'placeholder-stored-prompt-hash',
        ai_response_hash: null,
      },
    },
    ai_model: 'qwen/qwen3.8-27b',
    version_freeze: {
      ai_prompt_version: '7.0',
      ai_model: 'qwen/qwen3.8-27b',
    },
  };

  it('recomputes AI_CONTEXT_HASH, AI_INPUT_HASH, AI_PROMPT_HASH from feature_snapshot', () => {
    const result = recomputeHashesForPrediction(samplePrediction);

    expect(result.recomputed.ai_context_hash).not.toBeNull();
    expect(result.recomputed.ai_input_hash).not.toBeNull();
    expect(result.recomputed.ai_prompt_hash).not.toBeNull();
  });

  it('marks AI_RESPONSE_HASH as NOT_RECOMPUTABLE when a stored value exists', () => {
    // When the prediction has a stored ai_response_hash (a real LLM was used),
    // we cannot recompute it because the raw response text is not stored.
    // The script should report NOT_RECOMPUTABLE (we have a stored value but
    // cannot verify it).
    const predictionWithStoredResponseHash = {
      ...samplePrediction,
      ai_response_hash: 'a-real-stored-response-hash',
    };
    const result = recomputeHashesForPrediction(predictionWithStoredResponseHash);

    expect(result.recomputed.ai_response_hash).toBeNull();
    expect(result.match.ai_response_hash).toBe('NOT_RECOMPUTABLE');
    expect(result.notes).toContainEqual(
      expect.stringContaining('AI_RESPONSE_HASH is NOT recomputable')
    );
  });

  it('reports NO_STORED_VALUE for AI_RESPONSE_HASH when no value is stored (math-v2 fallback)', () => {
    // When the prediction was made with math-v2 fallback (no real LLM),
    // ai_response_hash is NULL. The script cannot recompute it (response text
    // not stored), and there's nothing to compare against — so NO_STORED_VALUE.
    const result = recomputeHashesForPrediction(samplePrediction);

    expect(result.recomputed.ai_response_hash).toBeNull();
    expect(result.match.ai_response_hash).toBe('NO_STORED_VALUE');
  });

  it('reports MATCH when stored hash equals recomputed hash (AI_CONTEXT_HASH)', () => {
    // First, compute the recomputed hash
    const recomputed = recomputeHashesForPrediction(samplePrediction);

    // Now create a new prediction where the stored hash IS the recomputed hash
    const matchingPrediction = {
      ...samplePrediction,
      ai_context_hash: recomputed.recomputed.ai_context_hash,
      ai_input_hash: recomputed.recomputed.ai_input_hash,
      ai_prompt_hash: recomputed.recomputed.ai_prompt_hash,
    };

    const result = recomputeHashesForPrediction(matchingPrediction);
    expect(result.match.ai_context_hash).toBe('MATCH');
    expect(result.match.ai_input_hash).toBe('MATCH');
    expect(result.match.ai_prompt_hash).toBe('MATCH');
  });

  it('reports MISMATCH when stored hash differs from recomputed hash', () => {
    const result = recomputeHashesForPrediction({
      ...samplePrediction,
      ai_context_hash: 'different-stored-hash',
    });

    expect(result.match.ai_context_hash).toBe('MISMATCH');
  });

  it('reports NO_STORED_VALUE when stored hash is null but recomputed is non-null', () => {
    const result = recomputeHashesForPrediction({
      ...samplePrediction,
      ai_context_hash: null,
      ai_input_hash: null,
      ai_prompt_hash: null,
    });

    expect(result.match.ai_context_hash).toBe('NO_STORED_VALUE');
    expect(result.match.ai_input_hash).toBe('NO_STORED_VALUE');
    expect(result.match.ai_prompt_hash).toBe('NO_STORED_VALUE');
  });

  it('reports NOT_RECOMPUTABLE for all hashes when feature_snapshot is null', () => {
    const result = recomputeHashesForPrediction({
      ...samplePrediction,
      feature_snapshot: null,
    });

    expect(result.has_feature_snapshot).toBe(false);
    expect(result.match.ai_context_hash).toBe('NOT_RECOMPUTABLE');
    expect(result.match.ai_input_hash).toBe('NOT_RECOMPUTABLE');
    expect(result.match.ai_prompt_hash).toBe('NOT_RECOMPUTABLE');
    expect(result.match.ai_response_hash).toBe('NO_STORED_VALUE');
    expect(result.notes).toContainEqual(
      expect.stringContaining('No feature_snapshot stored')
    );
  });

  it('reports NOT_RECOMPUTABLE for AI_INPUT_HASH when ai_snapshot is missing', () => {
    const result = recomputeHashesForPrediction({
      ...samplePrediction,
      feature_snapshot: {
        ...samplePrediction.feature_snapshot,
        ai_snapshot: undefined,
      },
    });

    expect(result.has_ai_snapshot).toBe(false);
    expect(result.match.ai_input_hash).toBe('NOT_RECOMPUTABLE');
  });

  it('verifies that empty string response yields null hash (Phase 8 fix)', () => {
    // This is tested via computeAIResponseHashFromContext in ai-context.ts
    // We re-verify here to ensure the recomputation pipeline doesn't
    // accidentally re-introduce a placeholder.
    const result = recomputeHashesForPrediction(samplePrediction);
    expect(result.recomputed.ai_response_hash).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Read-only verification
// ═══════════════════════════════════════════════════════════════════

describe('recompute-ai-hashes — read-only by design', () => {
  it('does not contain any SQL write statements (only SELECT)', () => {
    // The script only uses sql`...` for SELECT queries.
    // We verify by reading the source file and checking that no SQL write
    // statement appears as an actual sql`...` tagged template content.
    // (Comments may mention these words — we only check actual SQL statements.)
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/recompute-ai-hashes.ts'),
      'utf-8'
    );

    // Extract all sql`...` tagged template contents (the actual SQL queries)
    const sqlMatches = source.match(/sql`([\s\S]+?)`/g) || [];
    expect(sqlMatches.length).toBeGreaterThan(0);

    for (const sqlBlock of sqlMatches) {
      // Each sql`...` block must be a SELECT (no write operations)
      expect(sqlBlock).toMatch(/\bSELECT\b/i);
      expect(sqlBlock).not.toMatch(/\bINSERT\s+INTO\b/i);
      expect(sqlBlock).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
      expect(sqlBlock).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(sqlBlock).not.toMatch(/\bDROP\b/i);
      expect(sqlBlock).not.toMatch(/\bTRUNCATE\b/i);
      expect(sqlBlock).not.toMatch(/\bALTER\s+TABLE\b/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 6: Mutation tests — verify recomputation detects corruption
// ═══════════════════════════════════════════════════════════════════
// These tests verify that a small change to the source data produces a
// MISMATCH, proving the recomputation actually detects corruption (and
// is not just trivially returning MATCH for any input).

describe('recompute-ai-hashes — mutation tests (corruption detection)', () => {
  // Base fixture: a complete, valid prediction with all fields populated
  const baseFeatureSnapshot = {
    odds: {
      home: 1.85, draw: 3.40, away: 4.20,
      source_timestamp: '2026-09-24T10:00:00Z',
    },
    standings: {
      home: { position: 1, played: 10, won: 7, drawn: 2, lost: 1, goalsFor: 15, goalsAgainst: 5, points: 23 },
      away: { position: 5, played: 10, won: 4, drawn: 3, lost: 3, goalsFor: 12, goalsAgainst: 10, points: 15 },
      source_timestamp: '2026-09-24T09:00:00Z',
    },
    form: {
      home: [{ result: 'V', scoreHome: 2, scoreAway: 0 }],
      away: [{ result: 'D', scoreHome: 0, scoreAway: 1 }],
      source_timestamp: '2026-09-24T09:30:00Z',
    },
    h2h: {
      matches: [{ scoreHome: 2, scoreAway: 1 }],
      source_timestamp: '2026-09-24T09:45:00Z',
    },
    source_timestamps: {
      odds: '2026-09-24T10:00:00Z',
      ranking: '2026-09-24T09:00:00Z',
      form: '2026-09-24T09:30:00Z',
      h2h: '2026-09-24T09:45:00Z',
    },
    ai_snapshot: {
      odds: {
        home: { name: 'odds_home', value: 1.85, source: 'bookmaker/scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
        draw: { name: 'odds_draw', value: 3.40, source: 'bookmaker/scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
        away: { name: 'odds_away', value: 4.20, source: 'bookmaker/scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
        implied_home: { name: 'odds_implied_home', value: 54, source: 'calculated_from_odds', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
        implied_draw: { name: 'odds_implied_draw', value: 29, source: 'calculated_from_odds', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
        implied_away: { name: 'odds_implied_away', value: 24, source: 'calculated_from_odds', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
      },
      standings_home: { name: 'standings_home', value: '#1 10j 7V2N1D 15-5 23p att:1.5 def:0.5', source: 'ranking_table', source_timestamp: '2026-09-24T09:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
      standings_away: { name: 'standings_away', value: '#5 10j 4V3N3D 12-10 15p att:1.2 def:1.0', source: 'ranking_table', source_timestamp: '2026-09-24T09:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
      form_home: { name: 'form_home', value: 'V2-0', source: 'historical_matches', source_timestamp: '2026-09-24T09:30:00Z', version: '1.0.0', provenance: 'RECORDED' },
      form_away: { name: 'form_away', value: 'D0-1', source: 'historical_matches', source_timestamp: '2026-09-24T09:30:00Z', version: '1.0.0', provenance: 'RECORDED' },
      h2h: { name: 'h2h', value: '1V0N1D avg:3.0bm', source: 'historical_matches', source_timestamp: '2026-09-24T09:45:00Z', version: '1.0.0', provenance: 'RECORDED' },
      other: [],
    },
    match_index: 1,
    schema_version: '3.0',
  };

  const makeBasePrediction = () => ({
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    home_team: 'TeamA',
    away_team: 'TeamB',
    feature_snapshot: JSON.parse(JSON.stringify(baseFeatureSnapshot)),
    ai_context_hash: null as string | null,
    ai_input_hash: null as string | null,
    ai_prompt_hash: null as string | null,
    ai_response_hash: null as string | null,
    ai_trace: { hashes: {} },
    ai_model: 'qwen/qwen3.8-27b',
    version_freeze: { ai_prompt_version: '7.0', ai_model: 'qwen/qwen3.8-27b' },
  });

  // ─── AI_CONTEXT_HASH mutation tests ─────────────────────────────

  it('AI_CONTEXT_HASH: mutating odds.home produces MISMATCH', () => {
    // Step 1: compute the "stored" hash from the original fixture
    const originalPrediction = makeBasePrediction();
    const originalResult = recomputeHashesForPrediction(originalPrediction);
    const storedHash = originalResult.recomputed.ai_context_hash;
    expect(storedHash).not.toBeNull();

    // Step 2: set the stored hash, then mutate the source data
    const mutatedPrediction = makeBasePrediction();
    mutatedPrediction.ai_context_hash = storedHash; // stored hash from original
    // Mutate: change odds.home from 1.85 to 1.86
    (mutatedPrediction.feature_snapshot as any).odds.home = 1.86;

    // Step 3: recompute and verify MISMATCH
    const mutatedResult = recomputeHashesForPrediction(mutatedPrediction);
    expect(mutatedResult.match.ai_context_hash).toBe('MISMATCH');
    expect(mutatedResult.recomputed.ai_context_hash).not.toBe(storedHash);
  });

  it('AI_CONTEXT_HASH: mutating home_team produces MISMATCH', () => {
    const originalPrediction = makeBasePrediction();
    const originalResult = recomputeHashesForPrediction(originalPrediction);
    const storedHash = originalResult.recomputed.ai_context_hash;

    const mutatedPrediction = makeBasePrediction();
    mutatedPrediction.ai_context_hash = storedHash;
    mutatedPrediction.home_team = 'TeamX'; // mutated

    const mutatedResult = recomputeHashesForPrediction(mutatedPrediction);
    expect(mutatedResult.match.ai_context_hash).toBe('MISMATCH');
  });

  it('AI_CONTEXT_HASH: mutating standings.home.won produces MISMATCH', () => {
    const originalPrediction = makeBasePrediction();
    const originalResult = recomputeHashesForPrediction(originalPrediction);
    const storedHash = originalResult.recomputed.ai_context_hash;

    const mutatedPrediction = makeBasePrediction();
    mutatedPrediction.ai_context_hash = storedHash;
    (mutatedPrediction.feature_snapshot as any).standings.home.won = 8; // was 7

    const mutatedResult = recomputeHashesForPrediction(mutatedPrediction);
    expect(mutatedResult.match.ai_context_hash).toBe('MISMATCH');
  });

  it('AI_CONTEXT_HASH: mutating form.home array order produces MISMATCH', () => {
    // Add a second form entry to make the array order matter
    const originalPrediction = makeBasePrediction();
    (originalPrediction.feature_snapshot as any).form.home = [
      { result: 'V', scoreHome: 2, scoreAway: 0 },
      { result: 'N', scoreHome: 1, scoreAway: 1 },
    ];
    const originalResult = recomputeHashesForPrediction(originalPrediction);
    const storedHash = originalResult.recomputed.ai_context_hash;

    // Mutate: reverse the array order
    const mutatedPrediction = makeBasePrediction();
    (mutatedPrediction.feature_snapshot as any).form.home = [
      { result: 'N', scoreHome: 1, scoreAway: 1 },
      { result: 'V', scoreHome: 2, scoreAway: 0 },
    ];
    mutatedPrediction.ai_context_hash = storedHash;

    const mutatedResult = recomputeHashesForPrediction(mutatedPrediction);
    // JSON.stringify preserves array order, so reversing should produce a different hash
    expect(mutatedResult.match.ai_context_hash).toBe('MISMATCH');
  });

  // ─── AI_INPUT_HASH mutation tests ─────────────────────────────────

  it('AI_INPUT_HASH: mutating ai_snapshot.odds.home.value produces MISMATCH', () => {
    const originalPrediction = makeBasePrediction();
    const originalResult = recomputeHashesForPrediction(originalPrediction);
    const storedHash = originalResult.recomputed.ai_input_hash;
    expect(storedHash).not.toBeNull();

    const mutatedPrediction = makeBasePrediction();
    mutatedPrediction.ai_input_hash = storedHash;
    (mutatedPrediction.feature_snapshot as any).ai_snapshot.odds.home.value = 1.86; // was 1.85

    const mutatedResult = recomputeHashesForPrediction(mutatedPrediction);
    expect(mutatedResult.match.ai_input_hash).toBe('MISMATCH');
  });

  it('AI_INPUT_HASH: mutating ai_snapshot.h2h.value produces MISMATCH', () => {
    const originalPrediction = makeBasePrediction();
    const originalResult = recomputeHashesForPrediction(originalPrediction);
    const storedHash = originalResult.recomputed.ai_input_hash;

    const mutatedPrediction = makeBasePrediction();
    mutatedPrediction.ai_input_hash = storedHash;
    (mutatedPrediction.feature_snapshot as any).ai_snapshot.h2h.value = '2V0N0D avg:4.0bm'; // was '1V0N1D avg:3.0bm'

    const mutatedResult = recomputeHashesForPrediction(mutatedPrediction);
    expect(mutatedResult.match.ai_input_hash).toBe('MISMATCH');
  });

  // ─── AI_PROMPT_HASH mutation tests ────────────────────────────────

  it('AI_PROMPT_HASH: mutating odds.home (which affects user prompt) produces MISMATCH', () => {
    const originalPrediction = makeBasePrediction();
    const originalResult = recomputeHashesForPrediction(originalPrediction);
    const storedHash = originalResult.recomputed.ai_prompt_hash;
    expect(storedHash).not.toBeNull();

    const mutatedPrediction = makeBasePrediction();
    mutatedPrediction.ai_prompt_hash = storedHash;
    (mutatedPrediction.feature_snapshot as any).odds.home = 1.86; // affects implied prob and prompt

    const mutatedResult = recomputeHashesForPrediction(mutatedPrediction);
    expect(mutatedResult.match.ai_prompt_hash).toBe('MISMATCH');
  });

  it('AI_PROMPT_HASH: mutating home_team (appears in prompt) produces MISMATCH', () => {
    const originalPrediction = makeBasePrediction();
    const originalResult = recomputeHashesForPrediction(originalPrediction);
    const storedHash = originalResult.recomputed.ai_prompt_hash;

    const mutatedPrediction = makeBasePrediction();
    mutatedPrediction.ai_prompt_hash = storedHash;
    mutatedPrediction.home_team = 'DifferentTeam';

    const mutatedResult = recomputeHashesForPrediction(mutatedPrediction);
    expect(mutatedResult.match.ai_prompt_hash).toBe('MISMATCH');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 7: TS vs JS canonical function consistency
// ═══════════════════════════════════════════════════════════════════
// The recompute script imports from src/lib/ai-context.ts (TypeScript).
// The production code (api/analyze-match.js) imports from api/_lib/ai-context.js
// (JavaScript mirror). These are TWO DIFFERENT FILES. We verify they produce
// identical hash outputs for the same input by computing the hash manually
// with crypto (matching both implementations) and comparing.

describe('recompute-ai-hashes — TS vs JS canonical function consistency', () => {
  it('computeAIContextHash produces the same output as the JS mirror would', () => {
    // Both implementations use:
    //   sha256('ai_context:' + JSON.stringify({
    //     home, away, odds_home, odds_draw, odds_away,
    //     standings_home, standings_away, form_home, form_away, h2h
    //   }))
    //
    // The TS version has a no-op replacer function (always returns val).
    // We verify the no-op replacer doesn't change the output.
    const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

    const ctx = {
      home: 'TeamA', away: 'TeamB',
      odds: { home: 1.85, draw: 3.40, away: 4.20, source_timestamp: null },
      standings: { home: null, away: null, source_timestamp: null },
      form: { home: null, away: null, source_timestamp: null },
      h2h: { matches: null, source_timestamp: null },
      match_index: 1,
      source_timestamps: { odds: null, ranking: null, form: null, h2h: null },
    };

    // Manual computation matching both TS and JS implementations
    const canonical = JSON.stringify({
      home: ctx.home,
      away: ctx.away,
      odds_home: ctx.odds.home,
      odds_draw: ctx.odds.draw,
      odds_away: ctx.odds.away,
      standings_home: ctx.standings.home,
      standings_away: ctx.standings.away,
      form_home: ctx.form.home,
      form_away: ctx.form.away,
      h2h: ctx.h2h.matches,
    });
    const manualHash = sha256('ai_context:' + canonical);

    // Use the TS canonical function (imported at top of file)
    const tsHash = computeAIContextHash(ctx as any);

    expect(tsHash).toBe(manualHash);
  });

  it('computeAIInputHashFromContext uses the same sorted-parts algorithm as the JS mirror', () => {
    const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

    const inputs = {
      odds: {
        home: { name: 'odds_home', value: 1.85, source: 'scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
        draw: { name: 'odds_draw', value: 3.40, source: 'scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
        away: { name: 'odds_away', value: 4.20, source: 'scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
        implied_home: { name: 'odds_implied_home', value: 54, source: 'calculated', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
        implied_draw: { name: 'odds_implied_draw', value: 29, source: 'calculated', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
        implied_away: { name: 'odds_implied_away', value: 24, source: 'calculated', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
      },
      standings_home: null,
      standings_away: null,
      form_home: null,
      form_away: null,
      h2h: null,
      other: [],
    };

    // Manual computation matching both implementations
    const parts = [
      'odds_home:1.85',
      'odds_draw:3.4',
      'odds_away:4.2',
      'odds_implicit_h:54',
      'odds_implicit_d:29',
      'odds_implicit_a:24',
      'odds_ts:2026-09-24T10:00:00Z',
    ];
    parts.sort();
    const manualHash = sha256('ai_inputs:' + parts.join('|'));

    // Use the TS canonical function (imported at top of file)
    const tsHash = computeAIInputHashFromContext(inputs as any);

    expect(tsHash).toBe(manualHash);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 8: Verdict logic — no false PASS
// ═══════════════════════════════════════════════════════════════════

describe('recompute-ai-hashes — verdict logic (no false PASS)', () => {
  // The verdict must not produce a false PASS when:
  // - any recomputable hash MISMATCHES
  // - any recomputable hash is NOT_RECOMPUTABLE (data missing)
  // - any recomputable hash has NO_STORED_VALUE
  //
  // The script now uses explicit verdict labels:
  //   RECOMPUTABLE_HASHES_MATCH  — only when all 3 recomputable hashes MATCH
  //   MISMATCH_DETECTED          — when any recomputable hash MISMATCHES
  //   NOT_RECOMPUTABLE           — when any recomputable hash is NOT_RECOMPUTABLE
  //   NO_STORED_VALUE            — when any recomputable hash has NO_STORED_VALUE

  const makeMinimalPrediction = () => ({
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    home_team: 'TeamA',
    away_team: 'TeamB',
    feature_snapshot: {
      odds: { home: 1.85, draw: 3.40, away: 4.20, source_timestamp: null },
      standings: { home: null, away: null, source_timestamp: null },
      form: { home: null, away: null, source_timestamp: null },
      h2h: { matches: null, source_timestamp: null },
      source_timestamps: { odds: null, ranking: null, form: null, h2h: null },
      ai_snapshot: null,
      match_index: 1,
      schema_version: '3.0',
    },
    ai_context_hash: null as string | null,
    ai_input_hash: null as string | null,
    ai_prompt_hash: null as string | null,
    ai_response_hash: null as string | null,
    ai_trace: null,
    ai_model: null,
    version_freeze: null,
  });

  it('does not claim MATCH when stored hash is NULL but recomputed is non-null (NO_STORED_VALUE)', () => {
    const prediction = makeMinimalPrediction();
    prediction.ai_context_hash = null; // no stored value
    // feature_snapshot is present, so recomputed.ai_context_hash will be non-null

    const result = recomputeHashesForPrediction(prediction);
    expect(result.recomputed.ai_context_hash).not.toBeNull();
    expect(result.match.ai_context_hash).toBe('NO_STORED_VALUE');
    // This is NOT a MATCH — the verdict must not claim success
  });

  it('does not claim MATCH when recomputed hash is null but stored is non-null (NOT_RECOMPUTABLE)', () => {
    const prediction = makeMinimalPrediction();
    prediction.feature_snapshot = null; // cannot recompute
    prediction.ai_context_hash = 'some-stored-hash'; // but there's a stored value

    const result = recomputeHashesForPrediction(prediction);
    expect(result.recomputed.ai_context_hash).toBeNull();
    expect(result.match.ai_context_hash).toBe('NOT_RECOMPUTABLE');
    // This is NOT a MATCH — the verdict must not claim success
  });

  it('reports AI_RESPONSE_HASH correctly when math-v2 (no stored value, no LLM)', () => {
    const prediction = makeMinimalPrediction();
    prediction.ai_response_hash = null;

    const result = recomputeHashesForPrediction(prediction);
    expect(result.match.ai_response_hash).toBe('NO_STORED_VALUE');
  });

  it('reports AI_RESPONSE_HASH correctly when LLM was used (stored value, but not recomputable)', () => {
    const prediction = makeMinimalPrediction();
    prediction.ai_response_hash = 'a-stored-response-hash';

    const result = recomputeHashesForPrediction(prediction);
    expect(result.recomputed.ai_response_hash).toBeNull();
    expect(result.match.ai_response_hash).toBe('NOT_RECOMPUTABLE');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 9: Phase 5.3.11.2 — Sanitization diagnostic tests
// ═══════════════════════════════════════════════════════════════════
// When AI_CONTEXT_HASH MISMATCHES, the tool should diagnose whether the
// mismatch can be explained by production sanitization (HTML strip + 200
// char truncation of home_team/away_team).
//
// The tool does NOT convert MISMATCH to MATCH — it adds a diagnostic field
// that qualifies the likely cause.

describe('recompute-ai-hashes — Phase 5.3.11.2 sanitization diagnostic', () => {
  // Helper: build a complete feature_snapshot + prediction for testing
  const makeTestPrediction = (homeTeam: string, awayTeam: string, home?: string | null, away?: string | null) => {
    const featureSnapshot = {
      odds: { home: 1.85, draw: 3.40, away: 4.20, source_timestamp: '2026-09-24T10:00:00Z' },
      standings: {
        home: { position: 1, played: 10, won: 7, drawn: 2, lost: 1, goalsFor: 15, goalsAgainst: 5, points: 23 },
        away: { position: 5, played: 10, won: 4, drawn: 3, lost: 3, goalsFor: 12, goalsAgainst: 10, points: 15 },
        source_timestamp: '2026-09-24T09:00:00Z',
      },
      form: {
        home: [{ result: 'V', scoreHome: 2, scoreAway: 0 }],
        away: [{ result: 'D', scoreHome: 0, scoreAway: 1 }],
        source_timestamp: '2026-09-24T09:30:00Z',
      },
      h2h: {
        matches: [{ scoreHome: 2, scoreAway: 1 }],
        source_timestamp: '2026-09-24T09:45:00Z',
      },
      source_timestamps: {
        odds: '2026-09-24T10:00:00Z',
        ranking: '2026-09-24T09:00:00Z',
        form: '2026-09-24T09:30:00Z',
        h2h: '2026-09-24T09:45:00Z',
      },
      ai_snapshot: {
        odds: {
          home: { name: 'odds_home', value: 1.85, source: 'scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
          draw: { name: 'odds_draw', value: 3.40, source: 'scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
          away: { name: 'odds_away', value: 4.20, source: 'scraper', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
          implied_home: { name: 'odds_implied_home', value: 54, source: 'calculated', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
          implied_draw: { name: 'odds_implied_draw', value: 29, source: 'calculated', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
          implied_away: { name: 'odds_implied_away', value: 24, source: 'calculated', source_timestamp: '2026-09-24T10:00:00Z', version: '1.0.0', provenance: 'RECONSTRUCTED' },
        },
        standings_home: { name: 'standings_home', value: '#1', source: 'ranking_table', source_timestamp: '2026-09-24T09:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
        standings_away: { name: 'standings_away', value: '#5', source: 'ranking_table', source_timestamp: '2026-09-24T09:00:00Z', version: '1.0.0', provenance: 'RECORDED' },
        form_home: { name: 'form_home', value: 'V2-0', source: 'historical_matches', source_timestamp: '2026-09-24T09:30:00Z', version: '1.0.0', provenance: 'RECORDED' },
        form_away: { name: 'form_away', value: 'D0-1', source: 'historical_matches', source_timestamp: '2026-09-24T09:30:00Z', version: '1.0.0', provenance: 'RECORDED' },
        h2h: { name: 'h2h', value: '1V0N1D', source: 'historical_matches', source_timestamp: '2026-09-24T09:45:00Z', version: '1.0.0', provenance: 'RECORDED' },
        other: [],
      },
      match_index: 1,
      schema_version: '3.0',
    };

    return {
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      home_team: homeTeam,
      away_team: awayTeam,
      home: home ?? null,
      away: away ?? null,
      feature_snapshot: featureSnapshot,
      ai_context_hash: null as string | null,
      ai_input_hash: null as string | null,
      ai_prompt_hash: null as string | null,
      ai_response_hash: null as string | null,
      ai_trace: { hashes: {} },
      ai_model: 'qwen/qwen3.8-27b',
      version_freeze: { ai_prompt_version: '7.0', ai_model: 'qwen/qwen3.8-27b' },
    };
  };

  // Test A: Normal team name — no sanitization, no mismatch
  it('A: normal team name "Team Alpha" — MATCH, no diagnostic needed', () => {
    const prediction = makeTestPrediction('Team Alpha', 'Team Beta');
    // Compute the stored hash from the same data
    const preResult = recomputeHashesForPrediction(prediction);
    prediction.ai_context_hash = preResult.recomputed.ai_context_hash;

    const result = recomputeHashesForPrediction(prediction);
    expect(result.match.ai_context_hash).toBe('MATCH');
    expect(result.diagnostic.ai_context_hash).toBe('NONE'); // no diagnostic needed
  });

  // Test B: Team name with HTML — sanitization explains the mismatch
  it('B: team name with HTML "Team <b>Alpha</b>" — MISMATCH with diagnostic MISMATCH_POSSIBLE_SANITIZATION', () => {
    // The "stored" hash was computed with the UNSANITIZED name (match.home = "Team <b>Alpha</b>")
    // But predictions.home_team = sanitize("Team <b>Alpha</b>") = "Team Alpha" (HTML stripped)
    // So rebuilding with home_team="Team Alpha" produces a different hash → MISMATCH
    // But rebuilding with home="Team <b>Alpha</b>" (unsanitized column) → MATCH

    const unsanitizedHome = 'Team <b>Alpha</b>';
    const unsanitizedAway = 'Team <b>Beta</b>';
    const sanitizedHome = 'Team Alpha'; // sanitize() strips <b></b>
    const sanitizedAway = 'Team Beta';

    // Step 1: compute the stored hash using UNSANITIZED names (what production did)
    const storedPrediction = makeTestPrediction(unsanitizedHome, unsanitizedAway);
    const storedResult = recomputeHashesForPrediction(storedPrediction);
    const storedHash = storedResult.recomputed.ai_context_hash;
    expect(storedHash).not.toBeNull();

    // Step 2: now simulate the DB state: home_team=sanitized, home=unsanitized
    const dbPrediction = makeTestPrediction(sanitizedHome, sanitizedAway, unsanitizedHome, unsanitizedAway);
    dbPrediction.ai_context_hash = storedHash; // stored hash from unsanitized computation

    // Step 3: recompute — should MISMATCH (home_team is sanitized) but diagnostic should explain it
    const result = recomputeHashesForPrediction(dbPrediction);
    expect(result.match.ai_context_hash).toBe('MISMATCH'); // strict comparison fails
    expect(result.diagnostic.ai_context_hash).toBe('MISMATCH_POSSIBLE_SANITIZATION');
    expect(result.diagnostic.details.toLowerCase()).toContain('sanitize'); // check for "sanitize" or "sanitization"
  });

  // Test C: Team name >200 chars — truncation explains the mismatch (partially)
  it('C: team name >200 chars — MISMATCH with diagnostic (truncation cannot be fully recovered)', () => {
    const longName = 'A'.repeat(250); // 250 chars → truncated to 200 in home_team, 100 in home
    const unsanitizedHome = longName;
    const sanitizedHome = longName.substring(0, 200); // sanitize() truncates to 200

    // Stored hash was computed with the full 250-char name
    const storedPrediction = makeTestPrediction(unsanitizedHome, 'Team Beta');
    const storedResult = recomputeHashesForPrediction(storedPrediction);
    const storedHash = storedResult.recomputed.ai_context_hash;

    // DB state: home_team = first 200 chars, home = first 100 chars (both truncated)
    const dbPrediction = makeTestPrediction(
      sanitizedHome, 'Team Beta',
      unsanitizedHome.substring(0, 100), null, // home column truncated to 100
    );
    dbPrediction.ai_context_hash = storedHash;

    const result = recomputeHashesForPrediction(dbPrediction);
    expect(result.match.ai_context_hash).toBe('MISMATCH'); // neither home_team nor home can recover the full 250-char name
    // Diagnostic should indicate sanitization changed the value, but alternate hash still mismatches
    // (because home is only 100 chars, not the full 250)
    expect(result.diagnostic.ai_context_hash).toBe('MISMATCH_POSSIBLE_SANITIZATION');
    expect(result.diagnostic.details).toContain('longer than 100 chars');
  });

  // Test D: Real name change (not sanitization) — should NOT be explained by sanitization
  it('D: real name change "TeamA" → "TeamX" — MISMATCH with diagnostic MISMATCH_NO_SANITIZATION_EXPLANATION', () => {
    // Stored hash was computed with "TeamA"
    const storedPrediction = makeTestPrediction('TeamA', 'TeamB');
    const storedResult = recomputeHashesForPrediction(storedPrediction);
    const storedHash = storedResult.recomputed.ai_context_hash;

    // DB state: home_team = "TeamX" (completely different, not sanitization), home = "TeamX" (same)
    const dbPrediction = makeTestPrediction('TeamX', 'TeamB', 'TeamX', 'TeamB');
    dbPrediction.ai_context_hash = storedHash;

    const result = recomputeHashesForPrediction(dbPrediction);
    expect(result.match.ai_context_hash).toBe('MISMATCH');
    // Sanitization did NOT change the name (no HTML, <200 chars) → this is a real mismatch
    expect(result.diagnostic.ai_context_hash).toBe('MISMATCH_NO_SANITIZATION_EXPLANATION');
    expect(result.diagnostic.details).toContain('NOT explained');
  });

  // Test E: Odds mutation — should be MISMATCH but NOT explained by sanitization
  it('E: odds mutation 1.85 → 1.86 — MISMATCH with diagnostic MISMATCH_NO_SANITIZATION_EXPLANATION', () => {
    // Stored hash was computed with odds.home = 1.85
    const storedPrediction = makeTestPrediction('TeamA', 'TeamB');
    const storedResult = recomputeHashesForPrediction(storedPrediction);
    const storedHash = storedResult.recomputed.ai_context_hash;

    // DB state: odds.home = 1.86 (mutated), but team names are the same
    const dbPrediction = makeTestPrediction('TeamA', 'TeamB', 'TeamA', 'TeamB');
    (dbPrediction.feature_snapshot as any).odds.home = 1.86; // mutation
    dbPrediction.ai_context_hash = storedHash;

    const result = recomputeHashesForPrediction(dbPrediction);
    expect(result.match.ai_context_hash).toBe('MISMATCH');
    // Sanitization did NOT change the name → this is a real mismatch (odds mutation)
    expect(result.diagnostic.ai_context_hash).toBe('MISMATCH_NO_SANITIZATION_EXPLANATION');
  });

  // Test F: MISMATCH but home/away columns not provided — CANNOT_DIAGNOSE
  it('F: MISMATCH without home/away columns — diagnostic CANNOT_DIAGNOSE', () => {
    const storedPrediction = makeTestPrediction('TeamA', 'TeamB');
    const storedResult = recomputeHashesForPrediction(storedPrediction);
    const storedHash = storedResult.recomputed.ai_context_hash;

    // DB state: no home/away columns (null)
    const dbPrediction = makeTestPrediction('TeamX', 'TeamB', null, null);
    dbPrediction.ai_context_hash = storedHash;

    const result = recomputeHashesForPrediction(dbPrediction);
    expect(result.match.ai_context_hash).toBe('MISMATCH');
    expect(result.diagnostic.ai_context_hash).toBe('CANNOT_DIAGNOSE');
    expect(result.diagnostic.details).toContain('not provided');
  });
});
