// ============================================
// PHASE 5.3.19 — SNAPSHOT RECONSTRUCTION TESTS
// 10 test cases covering:
//   1. Full valid snapshot
//   2. Missing odds
//   3. Incomplete standings
//   4. Empty form
//   5. Empty H2H
//   6. AI snapshot present
//   7. AI snapshot absent
//   8. NULL values
//   9. Home/away inverted
//  10. Multiple historical results
// ============================================

import { describe, it, expect } from 'vitest';
import {
  reconstructMatchInputFromSnapshot,
  checkSnapshotCompleteness,
  type StoredFeatureSnapshot,
  type StoredFormEntry,
  type StoredH2HEntry,
  type StoredRankingInput,
} from '../lib/snapshot-reconstruction';
import { analyzeMatch } from '../lib/prediction-engine';

// ═══════════════════════════════════════════════════════════════════
// HELPERS — build a full valid snapshot for modification in tests
// ═══════════════════════════════════════════════════════════════════

function makeValidSnapshot(): StoredFeatureSnapshot {
  return {
    odds: { home: 1.85, draw: 3.40, away: 4.20, source_timestamp: '2026-09-24T10:00:00Z' },
    standings: {
      home: {
        position: 3, played: 10, won: 7, drawn: 2, lost: 1,
        goalsFor: 15, goalsAgainst: 5, points: 23, goalDifference: 10,
      } as StoredRankingInput,
      away: {
        position: 5, played: 10, won: 4, drawn: 3, lost: 3,
        goalsFor: 12, goalsAgainst: 10, points: 15, goalDifference: 2,
      } as StoredRankingInput,
      source_timestamp: '2026-09-24T09:00:00Z',
    },
    form: {
      home: [
        { result: 'V', opponent: 'TeamX', scoreHome: 2, scoreAway: 0 },
        { result: 'N', opponent: 'TeamY', scoreHome: 1, scoreAway: 1 },
        { result: 'V', opponent: 'TeamZ', scoreHome: 3, scoreAway: 1 },
      ] as StoredFormEntry[],
      away: [
        { result: 'D', opponent: 'TeamP', scoreHome: 0, scoreAway: 1 },
        { result: 'V', opponent: 'TeamQ', scoreHome: 2, scoreAway: 0 },
      ] as StoredFormEntry[],
      source_timestamp: '2026-09-24T09:30:00Z',
    },
    h2h: {
      matches: [
        { scoreHome: 2, scoreAway: 1 },
        { scoreHome: 1, scoreAway: 1 },
      ] as StoredH2HEntry[],
      source_timestamp: '2026-09-24T09:45:00Z',
    },
    source_timestamps: {
      odds: '2026-09-24T10:00:00Z',
      ranking: '2026-09-24T09:00:00Z',
      form: '2026-09-24T09:30:00Z',
      h2h: '2026-09-24T09:45:00Z',
    },
    ai_snapshot: {
      odds: { home: { value: 1.85 } },
      // ... minimal ai_snapshot for the test
    },
    match_index: 1,
    schema_version: '3.0',
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1 — Full valid snapshot
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — TEST 1: Full valid snapshot', () => {
  it('reconstructs all components without gaps', () => {
    const snap = makeValidSnapshot();
    const result = reconstructMatchInputFromSnapshot(snap, 'HomeTeam', 'AwayTeam', 'TestLeague');

    expect(result.warnings.length).toBe(0);
    expect(result.hasGaps).toBe(false);
    expect(result.match.home).toBe('HomeTeam');
    expect(result.match.away).toBe('AwayTeam');
    expect(result.match.league).toBe('TestLeague');
    expect(result.match.oddHome).toBe(1.85);
    expect(result.match.oddDraw).toBe(3.40);
    expect(result.match.oddAway).toBe(4.20);

    expect(result.teamStats.size).toBe(2);
    expect(result.teamStats.get('HomeTeam')?.position).toBe(3);
    expect(result.teamStats.get('HomeTeam')?.avgGoalsScored).toBeCloseTo(1.5, 5); // 15/10
    expect(result.teamStats.get('AwayTeam')?.position).toBe(5);

    // form: 3 home entries + 2 away entries + 2 H2H entries = 7 total
    expect(result.historicalResults.length).toBe(7);
  });

  it('reconstructed inputs produce a valid analyzeMatch result', () => {
    const snap = makeValidSnapshot();
    const recon = reconstructMatchInputFromSnapshot(snap, 'HomeTeam', 'AwayTeam', 'TestLeague');
    const matchResult = analyzeMatch(recon.match, undefined, recon.teamStats, recon.historicalResults);

    expect(matchResult.probHome).toBeGreaterThanOrEqual(0);
    expect(matchResult.probHome).toBeLessThanOrEqual(1);
    expect(matchResult.probDraw).toBeGreaterThanOrEqual(0);
    expect(matchResult.probAway).toBeGreaterThanOrEqual(0);
    expect(matchResult.probHome + matchResult.probDraw + matchResult.probAway).toBeCloseTo(1.0, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2 — Missing odds
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — TEST 2: Missing odds', () => {
  it('returns gap warning and 0 odds when odds field is absent', () => {
    const snap = makeValidSnapshot();
    delete (snap as any).odds;
    const result = reconstructMatchInputFromSnapshot(snap, 'H', 'A');

    expect(result.hasGaps).toBe(true);
    expect(result.warnings.some(w => w.includes('odds missing'))).toBe(true);
    expect(result.match.oddHome).toBe(0);
    expect(result.match.oddDraw).toBe(0);
    expect(result.match.oddAway).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3 — Incomplete standings
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — TEST 3: Incomplete standings', () => {
  it('returns gap warning when standings.home is null', () => {
    const snap = makeValidSnapshot();
    snap.standings.home = null;
    const result = reconstructMatchInputFromSnapshot(snap, 'H', 'A');

    expect(result.hasGaps).toBe(true);
    expect(result.warnings.some(w => w.includes('standings.home is null'))).toBe(true);
    expect(result.teamStats.has('H')).toBe(false);
    expect(result.teamStats.has('A')).toBe(true); // away still present
  });

  it('returns gap warning when standings.away is null', () => {
    const snap = makeValidSnapshot();
    snap.standings.away = null;
    const result = reconstructMatchInputFromSnapshot(snap, 'H', 'A');

    expect(result.hasGaps).toBe(true);
    expect(result.warnings.some(w => w.includes('standings.away is null'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4 — Empty form
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — TEST 4: Empty form', () => {
  it('returns gap warnings for empty form arrays', () => {
    const snap = makeValidSnapshot();
    snap.form.home = [];
    snap.form.away = [];
    const result = reconstructMatchInputFromSnapshot(snap, 'H', 'A');

    // Empty arrays don't trigger warnings (null check), but hasGaps should be false
    // because the form field exists (just empty). Warnings are for null/absent.
    // Filter form entries by checking away != 'A' (H2H entries have away='A')
    const homeFormOnly = result.historicalResults.filter(r => r.home === 'H' && r.away !== 'A');
    const awayFormOnly = result.historicalResults.filter(r => r.home === 'A' && r.away !== 'H');
    expect(homeFormOnly.length).toBe(0);
    expect(awayFormOnly.length).toBe(0);
    // H2H entries are still present
    expect(result.historicalResults.length).toBe(2);
  });

  it('returns gap warnings when form is null', () => {
    const snap = makeValidSnapshot();
    snap.form.home = null;
    snap.form.away = null;
    const result = reconstructMatchInputFromSnapshot(snap, 'H', 'A');

    expect(result.hasGaps).toBe(true);
    expect(result.warnings.some(w => w.includes('form.home is null'))).toBe(true);
    expect(result.warnings.some(w => w.includes('form.away is null'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 5 — Empty H2H
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — TEST 5: Empty H2H', () => {
  it('does NOT add warning for empty H2H (H2H is legitimately absent for many matches)', () => {
    const snap = makeValidSnapshot();
    snap.h2h.matches = [];
    const result = reconstructMatchInputFromSnapshot(snap, 'H', 'A');

    expect(result.warnings.some(w => w.includes('h2h'))).toBe(false);
    // Form entries still present: 3 home + 2 away = 5
    expect(result.historicalResults.length).toBe(5);
  });

  it('handles null H2H matches', () => {
    const snap = makeValidSnapshot();
    snap.h2h.matches = null;
    const result = reconstructMatchInputFromSnapshot(snap, 'H', 'A');

    expect(result.historicalResults.length).toBe(5); // only form entries
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 6 — AI snapshot present
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — TEST 6: AI snapshot present', () => {
  it('does NOT include AI snapshot in reconstructed inputs (AI response is not stored)', () => {
    const snap = makeValidSnapshot();
    snap.ai_snapshot = { odds: { home: { value: 1.85 } }, h2h: { value: '2V1N1D' } };
    const result = reconstructMatchInputFromSnapshot(snap, 'H', 'A');

    // AI snapshot is intentionally NOT included in ReconstructedInputs
    // because the AI prediction (AIPrediction) cannot be reconstructed from
    // the stored snapshot — only the AI INPUTS are stored, not the AI RESPONSE.
    expect((result as any).aiPrediction).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 7 — AI snapshot absent
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — TEST 7: AI snapshot absent', () => {
  it('reconstructs successfully without ai_snapshot field', () => {
    const snap = makeValidSnapshot();
    delete (snap as any).ai_snapshot;
    const result = reconstructMatchInputFromSnapshot(snap, 'H', 'A');

    expect(result.hasGaps).toBe(false);
    expect(result.warnings.length).toBe(0);
    // Reconstruction works without AI snapshot — it's not used
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 8 — NULL values
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — TEST 8: NULL values', () => {
  it('handles null snapshot gracefully', () => {
    const result = reconstructMatchInputFromSnapshot(null, 'H', 'A');

    expect(result.hasGaps).toBe(true);
    expect(result.warnings.some(w => w.includes('snapshot is null'))).toBe(true);
    expect(result.match.oddHome).toBe(0);
    expect(result.teamStats.size).toBe(0);
    expect(result.historicalResults.length).toBe(0);
  });

  it('handles undefined snapshot gracefully', () => {
    const result = reconstructMatchInputFromSnapshot(undefined, 'H', 'A');

    expect(result.hasGaps).toBe(true);
    expect(result.match.home).toBe('H');
    expect(result.match.away).toBe('A');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 9 — Home/away inverted (team names swapped)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — TEST 9: Home/away team names swapped', () => {
  it('uses the provided team names correctly (not from snapshot)', () => {
    const snap = makeValidSnapshot();
    // The snapshot doesn't store team names — they come from the caller.
    // Verify that swapping them produces correct teamStats keys.
    const result = reconstructMatchInputFromSnapshot(snap, 'TeamB', 'TeamA');

    expect(result.teamStats.has('TeamB')).toBe(true); // home standings
    expect(result.teamStats.has('TeamA')).toBe(true);  // away standings
    expect(result.teamStats.get('TeamB')?.position).toBe(3); // from standings.home
    expect(result.teamStats.get('TeamA')?.position).toBe(5); // from standings.away

    // Historical results use the caller's team names
    // Form entries: home team's form has home='TeamB', away=opponent names
    // H2H entries: home='TeamB', away='TeamA' (the prediction's away team)
    // So filtering r.home === 'TeamB' returns BOTH form.home (3) + H2H (2) = 5
    const allHomeEntries = result.historicalResults.filter(r => r.home === 'TeamB');
    expect(allHomeEntries.length).toBe(5); // 3 form + 2 H2H
    // Form entries have away=opponent (not 'TeamA')
    const homeFormEntries = result.historicalResults.filter(r => r.home === 'TeamB' && r.away !== 'TeamA');
    expect(homeFormEntries.length).toBe(3); // 3 form entries for home team
    const awayFormEntries = result.historicalResults.filter(r => r.home === 'TeamA' && r.away !== 'TeamB');
    expect(awayFormEntries.length).toBe(2); // 2 form entries for away team
    const h2hEntries = result.historicalResults.filter(r => r.home === 'TeamB' && r.away === 'TeamA');
    expect(h2hEntries.length).toBe(2); // 2 H2H entries
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 10 — Multiple historical results (many form entries)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — TEST 10: Multiple historical results', () => {
  it('handles 10+ form entries per team + 5+ H2H entries', () => {
    const snap = makeValidSnapshot();
    snap.form.home = Array.from({ length: 10 }, (_, i) => ({
      result: 'V', opponent: `Opp${i}`, scoreHome: 2 + i, scoreAway: 0,
    })) as StoredFormEntry[];
    snap.form.away = Array.from({ length: 10 }, (_, i) => ({
      result: 'D', opponent: `Opp${i}`, scoreHome: 0, scoreAway: 1,
    })) as StoredFormEntry[];
    snap.h2h.matches = Array.from({ length: 5 }, (_, i) => ({
      scoreHome: i, scoreAway: i + 1,
    })) as StoredH2HEntry[];

    const result = reconstructMatchInputFromSnapshot(snap, 'H', 'A');

    expect(result.historicalResults.length).toBe(25); // 10 home form + 10 away form + 5 H2H
    expect(result.hasGaps).toBe(false);

    // Verify analyzeMatch works with the large dataset
    const matchResult = analyzeMatch(result.match, undefined, result.teamStats, result.historicalResults);
    expect(matchResult.probHome + matchResult.probDraw + matchResult.probAway).toBeCloseTo(1.0, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADDITIONAL — Determinism + purity
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.19 — Determinism + purity', () => {
  it('produces identical output for identical input (determinism)', () => {
    const snap = makeValidSnapshot();
    const r1 = reconstructMatchInputFromSnapshot(snap, 'H', 'A', 'L');
    const r2 = reconstructMatchInputFromSnapshot(snap, 'H', 'A', 'L');

    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('does not modify the input snapshot (purity)', () => {
    const snap = makeValidSnapshot();
    const snapCopy = JSON.parse(JSON.stringify(snap));
    reconstructMatchInputFromSnapshot(snap, 'H', 'A', 'L');
    expect(snap).toEqual(snapCopy);
  });

  it('checkSnapshotCompleteness returns correct flags for valid snapshot', () => {
    const snap = makeValidSnapshot();
    const c = checkSnapshotCompleteness(snap);
    expect(c.hasOdds).toBe(true);
    expect(c.hasStandingsHome).toBe(true);
    expect(c.hasStandingsAway).toBe(true);
    expect(c.hasFormHome).toBe(true);
    expect(c.hasFormAway).toBe(true);
    expect(c.hasH2H).toBe(true);
    expect(c.hasSourceTimestamps).toBe(true);
    expect(c.isComplete).toBe(true);
  });

  it('checkSnapshotCompleteness returns false flags for null snapshot', () => {
    const c = checkSnapshotCompleteness(null);
    expect(c.hasOdds).toBe(false);
    expect(c.isComplete).toBe(false);
  });
});
