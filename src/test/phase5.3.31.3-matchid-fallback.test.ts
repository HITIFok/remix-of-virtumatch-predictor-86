// ============================================
// PHASE 5.3.31.3 — match_id-FIRST PREDICTION FALLBACK TESTS
// Validates the correction applied to LiveMatches.tsx enhanceWithAI()
// (lines ~570-583):
//
//   const predId = predictionIdMap.current.get(matchKey)
//     || (
//       t.match.id != null
//         ? dbPredictions.find(p => p.matchId === t.match.id)?.id
//         : dbPredictions.find(p => `${p.homeTeam}-${p.awayTeam}` === matchKey)?.id
//     );
//
// INVARIANTS:
//   1. predictionIdMap stays the highest-priority source (Map HIT wins).
//   2. When t.match.id is present (number), the fallback uses matchId
//      (NOT team-name).
//   3. When t.match.id is present but no dbPredictions row matches
//      that matchId, predId is undefined. The system MUST NOT fall
//      back to team-name matching in this case (prevents selecting a
//      stale UUID from a different fixture with the same team names).
//   4. Legacy team-name fallback ONLY triggers when t.match.id is
//      absent (undefined / null) — e.g. pre-Phase-5.3.17 scraped rows
//      without a Sporty id.
// ============================================

import { describe, it, expect } from 'vitest';
import type { Prediction } from '../hooks/use-predictions';
import type { ScrapedMatch } from '../lib/types';

// ═══════════════════════════════════════════════════════════════════
// HELPERS — minimal Prediction factory
// ═══════════════════════════════════════════════════════════════════

function makePrediction(
  id: string,
  matchId: number | null,
  home: string,
  away: string,
): Prediction {
  return {
    id,
    matchId,
    homeTeam: home,
    awayTeam: away,
    league: 'Test',
    leagueId: '1',
    oddHome: 2.0,
    oddDraw: 3.0,
    oddAway: 4.0,
    probHome: 0.5,
    probDraw: 0.25,
    probAway: 0.25,
    prediction: '1',
    confidence: 50,
    predictedHomeScore: 1,
    predictedAwayScore: 0,
    predictedScore: '1-0',
    winner1x2: '1 — Test',
    status: 'pending',
    home: home,
    away: away,
    scoreHome: 1,
    scoreAway: 0,
    exactScore: '1-0',
    createdAt: '2026-09-29T12:00:00.000Z',
    verifiedAt: null,
    actualOutcome: null,
    actualScore: null,
    actualHomeScore: null,
    actualAwayScore: null,
    featureSnapshot: null,
    modelVersion: null,
    featureVersion: null,
    configVersion: null,
    calibrationVersion: null,
    datasetVersion: null,
    featureSnapshotHash: null,
    predictionHash: null,
    snapshotTimestamp: null,
    provenanceStatus: null,
    aiContextHash: null,
    aiInputHash: null,
    aiPromptHash: null,
    aiResponseHash: null,
    aiPromptVersion: null,
    aiModel: null,
    aiTrace: null,
    aiCallStatus: null,
    aiResponseLength: null,
    completenessScore: null,
    temporalSafetyScore: null,
    temporalSafetyReason: null,
    timestampProvenance: null,
    aiProvenanceRisk: null,
    scientificCollectionEligible: null,
    versionFreeze: null,
    tFeature: null,
    tPrediction: null,
    datasetSplit: null,
    probGg: null,
    probGn: null,
    bttsProb: null,
    over25Prob: null,
    firstHalfGoalProb: null,
    expectedGoals: null,
    ggResult: null,
    totalGoals: null,
    parity: null,
    overUnder15: null,
    overUnder25: null,
    overUnder35: null,
    round: null,
  } as Prediction;
}

// ═══════════════════════════════════════════════════════════════════
// Pure replica of the LiveMatches.tsx fallback (lines 570-583)
// This is the EXACT logic under test. Any change to LiveMatches.tsx
// must be mirrored here, otherwise tests will not reflect production.
// ═══════════════════════════════════════════════════════════════════

/**
 * Replicates the production fallback:
 *   predictionIdMap.current.get(matchKey)
 *     || (
 *       t.match.id != null
 *         ? dbPredictions.find(p => p.matchId === t.match.id)?.id
 *         : dbPredictions.find(p => `${p.homeTeam}-${p.awayTeam}` === matchKey)?.id
 *     )
 *
 * @param matchKey  `${home}-${away}` string (still used as the predictionIdMap key)
 * @param matchId   t.match.id (number | undefined | null)
 * @param map       predictionIdMap.current
 * @param db        dbPredictions
 */
function findPredictionId(
  matchKey: string,
  matchId: number | undefined | null,
  map: Map<string, string>,
  db: Prediction[],
): string | undefined {
  return (
    map.get(matchKey) ||
    (matchId != null
      ? db.find((p) => p.matchId === matchId)?.id
      : db.find((p) => `${p.homeTeam}-${p.awayTeam}` === matchKey)?.id)
  );
}

// ═══════════════════════════════════════════════════════════════════
// ScrapedMatch factory (only the fields used in the production flow)
// ═══════════════════════════════════════════════════════════════════

function makeMatch(
  id: number | undefined,
  home: string,
  away: string,
): Pick<ScrapedMatch, 'id' | 'home' | 'away'> {
  return { id, home, away };
}

// ═══════════════════════════════════════════════════════════════════
// CASE A — predictionIdMap HIT (Map wins over db)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — CASE A: predictionIdMap HIT wins', () => {
  it('returns UUID from Map even when dbPredictions has different UUID for same matchId', () => {
    const map = new Map([['Team A-Team B', 'UUID-A']]);
    const db = [makePrediction('UUID-B', 2002, 'Team A', 'Team B')];
    const match = makeMatch(2002, 'Team A', 'Team B');
    const matchKey = `${match.home}-${match.away}`;
    const result = findPredictionId(matchKey, match.id, map, db);
    expect(result).toBe('UUID-A');
  });
});

// ═══════════════════════════════════════════════════════════════════
// CASE B — Map MISS + matchId HIT in db
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — CASE B: Map MISS + matchId HIT', () => {
  it('finds UUID by matchId when map is empty', () => {
    const map = new Map<string, string>();
    const db = [
      makePrediction('UUID-A', 1001, 'Team A', 'Team B'),
      makePrediction('UUID-B', 2002, 'Team A', 'Team B'),
    ];
    const match = makeMatch(2002, 'Team A', 'Team B');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    expect(result).toBe('UUID-B');
  });
});

// ═══════════════════════════════════════════════════════════════════
// CASE C — same teams, different matchId → MUST return undefined
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — CASE C: same teams / different matchId (CRITICAL)', () => {
  it('returns undefined when only a stale same-team prediction exists with a different matchId', () => {
    const map = new Map<string, string>();
    const db = [makePrediction('UUID-A', 1001, 'Team A', 'Team B')]; // only stale
    const match = makeMatch(2002, 'Team A', 'Team B'); // current fixture
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    // MUST be undefined — never fall back to team-name when matchId is present
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// CASE D — multiple matches with same teams / different matchId
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — CASE D: same teams, two predictions (different matchId)', () => {
  it('returns UUID-B (matchId=2002), never UUID-A (matchId=1001)', () => {
    const map = new Map<string, string>();
    const db = [
      makePrediction('UUID-A', 1001, 'Team A', 'Team B'),
      makePrediction('UUID-B', 2002, 'Team A', 'Team B'),
    ];
    const match = makeMatch(2002, 'Team A', 'Team B');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    expect(result).toBe('UUID-B');
    expect(result).not.toBe('UUID-A');
  });

  it('returns UUID-A when current matchId is 1001 (even though UUID-B appears later in array)', () => {
    const map = new Map<string, string>();
    const db = [
      makePrediction('UUID-A', 1001, 'Team A', 'Team B'),
      makePrediction('UUID-B', 2002, 'Team A', 'Team B'),
    ];
    const match = makeMatch(1001, 'Team A', 'Team B');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    expect(result).toBe('UUID-A');
  });
});

// ═══════════════════════════════════════════════════════════════════
// CASE E — multiple distinct matches
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — CASE E: multiple distinct fixtures', () => {
  it('resolves each fixture to its own UUID via matchId', () => {
    const map = new Map<string, string>();
    const db = [
      makePrediction('UUID-A', 1001, 'Team A', 'Team B'),
      makePrediction('UUID-B', 2002, 'Team A', 'Team B'), // same teams, different matchId
      makePrediction('UUID-C', 3001, 'Team C', 'Team D'),
    ];

    const m1 = makeMatch(1001, 'Team A', 'Team B');
    const m2 = makeMatch(2002, 'Team A', 'Team B');
    const m3 = makeMatch(3001, 'Team C', 'Team D');

    expect(findPredictionId(`${m1.home}-${m1.away}`, m1.id, map, db)).toBe('UUID-A');
    expect(findPredictionId(`${m2.home}-${m2.away}`, m2.id, map, db)).toBe('UUID-B');
    expect(findPredictionId(`${m3.home}-${m3.away}`, m3.id, map, db)).toBe('UUID-C');
  });
});

// ═══════════════════════════════════════════════════════════════════
// CASE F — match.id absent → legacy team-name fallback
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — CASE F: match.id absent → legacy team-name fallback', () => {
  it('falls back to team-name when match.id is undefined', () => {
    const map = new Map<string, string>();
    const db = [makePrediction('UUID-A', null, 'Team A', 'Team B')];
    const match = makeMatch(undefined, 'Team A', 'Team B');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    expect(result).toBe('UUID-A');
  });

  it('falls back to team-name when match.id is null', () => {
    const map = new Map<string, string>();
    const db = [makePrediction('UUID-A', null, 'Team A', 'Team B')];
    const matchId: number | null = null;
    const result = findPredictionId('Team A-Team B', matchId, map, db);
    expect(result).toBe('UUID-A');
  });

  it('returns undefined when match.id is undefined and no team-name match exists', () => {
    const map = new Map<string, string>();
    const db = [makePrediction('UUID-A', null, 'Other Home', 'Other Away')];
    const match = makeMatch(undefined, 'Team A', 'Team B');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// CASE G — matchId present, no DB match → MUST return undefined
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — CASE G: matchId present but no DB match', () => {
  it('returns undefined when current matchId is not in db (no wrong team-name fallback)', () => {
    const map = new Map<string, string>();
    const db = [
      makePrediction('UUID-A', 1001, 'Team A', 'Team B'),
      makePrediction('UUID-B', 2002, 'Team A', 'Team B'),
    ];
    const match = makeMatch(9999, 'Team A', 'Team B'); // unknown matchId, same teams
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    // CRITICAL: must NOT fall back to UUID-A or UUID-B (which have same team names)
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// PRIORITY TEST — Map HIT with conflicting dbPredictions entry
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — PRIORITY: predictionIdMap wins over matchId-based db lookup', () => {
  it('Map UUID is returned even when dbPredictions has a different UUID for the SAME matchId', () => {
    const map = new Map([['Team A-Team B', 'UUID-MAP']]);
    const db = [makePrediction('UUID-DB', 2002, 'Team A', 'Team B')];
    const match = makeMatch(2002, 'Team A', 'Team B');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    expect(result).toBe('UUID-MAP');
    expect(result).not.toBe('UUID-DB');
  });
});

// ═══════════════════════════════════════════════════════════════════
// NON-COLLISION TEST — same teams, different matchIds never collide
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — NON-COLLISION: same teams, different matchIds', () => {
  it('two fixtures with identical team names but different matchIds resolve to their own UUIDs', () => {
    const map = new Map<string, string>();
    const db = [
      makePrediction('UUID-A', 1001, 'Team A', 'Team B'),
      makePrediction('UUID-B', 2002, 'Team A', 'Team B'),
    ];

    const m1 = makeMatch(1001, 'Team A', 'Team B');
    const m2 = makeMatch(2002, 'Team A', 'Team B');

    expect(findPredictionId(`${m1.home}-${m1.away}`, m1.id, map, db)).toBe('UUID-A');
    expect(findPredictionId(`${m2.home}-${m2.away}`, m2.id, map, db)).toBe('UUID-B');

    // Reverse lookup must still produce consistent results
    expect(findPredictionId(`${m1.home}-${m1.away}`, m1.id, map, db)).toBe('UUID-A');
    expect(findPredictionId(`${m2.home}-${m2.away}`, m2.id, map, db)).toBe('UUID-B');
  });

  it('current matchId=2002 never accidentally returns UUID-A (matchId=1001) via team-name', () => {
    const map = new Map<string, string>();
    const db = [
      makePrediction('UUID-A', 1001, 'Team A', 'Team B'),
      // Note: UUID-B intentionally absent — only stale UUID-A exists
    ];
    const match = makeMatch(2002, 'Team A', 'Team B');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    expect(result).toBeUndefined();
    expect(result).not.toBe('UUID-A');
  });
});

// ═══════════════════════════════════════════════════════════════════
// UNKNOWN MATCH_ID TEST
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — UNKNOWN matchId: never selects stale team-name match', () => {
  it('current matchId=3003 with same teams as historical matchId=1001 returns undefined', () => {
    const map = new Map<string, string>();
    const db = [
      makePrediction('UUID-A', 1001, 'Team A', 'Team B'),
      makePrediction('UUID-B', 2002, 'Team A', 'Team B'),
    ];
    const match = makeMatch(3003, 'Team A', 'Team B');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    expect(result).toBeUndefined();
  });

  it('current matchId=9999 with DIFFERENT teams from any DB row returns undefined', () => {
    const map = new Map<string, string>();
    const db = [
      makePrediction('UUID-A', 1001, 'Team A', 'Team B'),
      makePrediction('UUID-C', 3001, 'Team C', 'Team D'),
    ];
    const match = makeMatch(9999, 'Team X', 'Team Y');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// LEGACY FALLBACK TEST — only when match.id is absent
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — LEGACY fallback: ONLY_WHEN_MATCH_ID_ABSENT', () => {
  it('team-name fallback resolves when match.id is undefined', () => {
    const map = new Map<string, string>();
    const db = [makePrediction('UUID-A', null, 'Team A', 'Team B')];
    const matchId: undefined = undefined;
    const result = findPredictionId('Team A-Team B', matchId, map, db);
    expect(result).toBe('UUID-A');
  });

  it('team-name fallback does NOT trigger when match.id is present', () => {
    const map = new Map<string, string>();
    const db = [makePrediction('UUID-A', null, 'Team A', 'Team B')]; // matchId is NULL in DB
    const match = makeMatch(2002, 'Team A', 'Team B'); // current has match.id
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    // The DB row has matchId=NULL — it does NOT equal 2002, so result is undefined.
    // Critically: we do NOT silently select UUID-A by team-name when match.id is present.
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// EDGE — empty map + empty db (race scenario)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — EDGE: empty map + empty db (race)', () => {
  it('returns undefined — classification: PRE-EXISTING RACE (unchanged by this phase)', () => {
    const map = new Map<string, string>();
    const db: Prediction[] = [];
    const match = makeMatch(2002, 'Team A', 'Team B');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    expect(result).toBeUndefined();
    // LOAD_PREDICTIONS_RACE = PRE-EXISTING / UNCHANGED — not addressed by 5.3.31.3
  });
});

// ═══════════════════════════════════════════════════════════════════
// EDGE — match.id is 0 (falsy but valid number)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.31.3 — EDGE: match.id = 0 (falsy but valid)', () => {
  it('treats match.id=0 as a valid matchId (does not skip to legacy team-name path)', () => {
    const map = new Map<string, string>();
    const db = [
      makePrediction('UUID-ZERO', 0, 'Team A', 'Team B'),
      makePrediction('UUID-OTHER', 1001, 'Team A', 'Team B'),
    ];
    const match = makeMatch(0, 'Team A', 'Team B');
    const result = findPredictionId(`${match.home}-${match.away}`, match.id, map, db);
    // match.id=0 is `!= null`, so matchId branch is used → UUID-ZERO
    expect(result).toBe('UUID-ZERO');
    expect(result).not.toBe('UUID-OTHER');
  });
});
