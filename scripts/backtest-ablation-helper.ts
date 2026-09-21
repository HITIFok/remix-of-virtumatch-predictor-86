// Backtest ablation helper — runs prediction engine with coefficient overrides
// Called by backtest-framework.ts via child_process with env vars set
import { analyzeMatch } from '../src/lib/prediction-engine';
import * as fs from 'fs';

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error('Usage: tsx backtest-ablation-helper.ts <input.json> <output.json>');
  process.exit(1);
}

const inputData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const results = inputData.map((d: any) => {
  try {
    const r = analyzeMatch({
      home: d.home,
      away: d.away,
      league: d.league,
      oddHome: d.oddHome,
      oddDraw: d.oddDraw,
      oddAway: d.oddAway,
    });
    const predicted = r.winner1X2.startsWith('1') ? '1' : r.winner1X2.startsWith('2') ? '2' : 'X';
    return {
      predicted,
      actual: d.actual,
      probHome: r.probHome,
      probDraw: r.probDraw,
      probAway: r.probAway,
    };
  } catch (err) {
    const predicted = d.probHome >= d.probDraw && d.probHome >= d.probAway ? '1' : d.probDraw >= d.probAway ? 'X' : '2';
    return {
      predicted,
      actual: d.actual,
      probHome: d.probHome,
      probDraw: d.probDraw,
      probAway: d.probAway,
    };
  }
});

fs.writeFileSync(outputPath, JSON.stringify(results));
