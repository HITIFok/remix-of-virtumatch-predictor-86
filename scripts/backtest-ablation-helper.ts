// Backtest ablation helper — runs prediction engine with coefficient overrides
// Called by backtest-engine.ts via child_process with env vars set
//
// Phase 5.3.21: Extended to accept full reconstructed inputs (match + teamStats + historicalResults)
// so that WITHOUT_MOMENTUM and other coefficient-override ablations can run with
// the same feature data as the in-process ablations.
import { analyzeMatch, type TeamStats, type HistoricalResult } from '../src/lib/prediction-engine';
import * as fs from 'fs';

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error('Usage: tsx backtest-ablation-helper.ts <input.json> <output.json>');
  process.exit(1);
}

const inputData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// Support both old format (array of {home, away, ...}) and new format (single reconstructed input)
const isBatch = Array.isArray(inputData);
const items = isBatch ? inputData : [inputData];

const results = items.map((d: any) => {
  try {
    // New format: includes teamStatsArray + historicalResults
    const match = {
      home: d.home || d.match?.home,
      away: d.away || d.match?.away,
      league: d.league || d.match?.league || 'Unknown',
      oddHome: d.oddHome || d.match?.oddHome,
      oddDraw: d.oddDraw || d.match?.oddDraw,
      oddAway: d.oddAway || d.match?.oddAway,
    };

    // Reconstruct teamStats Map from serialized array
    let teamStats: Map<string, TeamStats> | undefined;
    if (d.teamStatsArray && Array.isArray(d.teamStatsArray)) {
      teamStats = new Map<string, TeamStats>();
      for (const ts of d.teamStatsArray) {
        if (ts && ts.name) {
          teamStats.set(ts.name, ts as TeamStats);
        }
      }
    }

    // historicalResults
    const historicalResults: HistoricalResult[] = d.historicalResults || [];

    const r = analyzeMatch(match, undefined, teamStats, historicalResults);
    const predicted = r.winner1X2.startsWith('1') ? '1' : r.winner1X2.startsWith('2') ? '2' : 'X';
    return {
      predicted,
      actual: d.actual,
      probHome: r.probHome,
      probDraw: r.probDraw,
      probAway: r.probAway,
      confidence: r.aiConfidence,
      scoreHome: r.scoreHome,
      scoreAway: r.scoreAway,
    };
  } catch (err) {
    // Fallback to normalized odds
    const oddHome = d.oddHome || d.match?.oddHome || 2;
    const oddDraw = d.oddDraw || d.match?.oddDraw || 3;
    const oddAway = d.oddAway || d.match?.oddAway || 3;
    const invH = 1 / oddHome, invD = 1 / oddDraw, invA = 1 / oddAway;
    const total = invH + invD + invA;
    const pH = invH / total, pD = invD / total, pA = invA / total;
    const predicted = pH >= pD && pH >= pA ? '1' : pA >= pD ? '2' : 'X';
    return {
      predicted,
      actual: d.actual,
      probHome: pH,
      probDraw: pD,
      probAway: pA,
      confidence: 0,
      scoreHome: 0,
      scoreAway: 0,
    };
  }
});

fs.writeFileSync(outputPath, JSON.stringify(isBatch ? results : results[0]));
