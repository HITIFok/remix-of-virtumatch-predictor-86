// Phase 2: Deep inspection of query params and hidden data
// Focus: ?include= params, eventBetTypes, betTypes, halfTimeScore in results

const API_BASE = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues';
const HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'fr',
  'app-version': '33470',
  'referer': 'https://bet261.mg/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
};

async function fetchJSON(path, label) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// ─── 1. DEEP INSPECT eventBetTypes on matches ───
async function inspectEventBetTypes() {
  console.log('='.repeat(80));
  console.log('1. DEEP INSPECT: eventBetTypes on /matches (current round)');
  console.log('='.repeat(80));

  const leagues = ['8035', '8060', '8056'];
  for (const lid of leagues) {
    console.log(`\n--- League ${lid} ---`);
    const data = await fetchJSON(`/${lid}/matches`, `${lid}`);
    if (!data?.rounds) continue;
    
    // Get the FIRST round with matches (current/upcoming)
    for (const rd of data.rounds) {
      if (!rd.matches?.length) continue;
      
      console.log(`\n  Round ${rd.roundNumber} (${rd.matches.length} matches):`);
      for (const m of rd.matches.slice(0, 2)) {
        console.log(`\n  ${m.homeTeam?.name} vs ${m.awayTeam?.name} (ID: ${m.id})`);
        
        // eventBetTypes - this is the key field with bet types
        if (m.eventBetTypes) {
          console.log(`  eventBetTypes (${Array.isArray(m.eventBetTypes) ? m.eventBetTypes.length : '?'} items):`);
          for (const bt of (m.eventBetTypes || []).slice(0, 20)) {
            console.log(`    [${bt.betTypeId || '?'}] "${bt.betTypeName || '?'}" id=${bt.id || '?'}`);
          }
        }
        
        // betTypes at round level
        if (rd.betTypes) {
          console.log(`  Round betTypes (${rd.betTypes.length}):`);
          for (const bt of rd.betTypes.slice(0, 10)) {
            console.log(`    "${bt.betTypeName || bt.name || '?'}" id=${bt.id || bt.betTypeId || '?'}`);
          }
        }
      }
      break; // Only first round
    }
  }
}

// ─── 2. COMPARE: /matches vs /matches?include=XXX ───
async function compareIncludeParams() {
  console.log('\n' + '='.repeat(80));
  console.log('2. COMPARE: /matches vs /matches?include=XXX (find what changes)');
  console.log('='.repeat(80));

  const lid = '8035';
  const baseData = await fetchJSON(`/${lid}/matches`, 'base');
  if (!baseData?.rounds) return;
  
  const baseRound = baseData.rounds.find(r => r.matches?.length > 0);
  if (!baseRound) return;
  const baseMatch = baseRound.matches[0];
  const baseKeys = Object.keys(baseMatch).sort();
  console.log(`\nBase match keys: ${baseKeys.join(', ')}`);
  
  const includeParams = ['results', 'bets', 'odds', 'scores', 'playout'];
  
  for (const param of includeParams) {
    const incData = await fetchJSON(`/${lid}/matches?include=${param}`, `include=${param}`);
    if (!incData?.rounds) continue;
    
    const incRound = incData.rounds.find(r => r.matches?.length > 0);
    if (!incRound) continue;
    const incMatch = incRound.matches[0];
    const incKeys = Object.keys(incMatch).sort();
    
    // Find new keys
    const newKeys = incKeys.filter(k => !baseKeys.includes(k));
    if (newKeys.length > 0) {
      console.log(`\n?include=${param}: NEW KEYS: ${newKeys.join(', ')}`);
      for (const k of newKeys) {
        const val = incMatch[k];
        const preview = JSON.stringify(val).substring(0, 300);
        console.log(`  ${k} = ${preview}`);
      }
    } else {
      console.log(`\n?include=${param}: no new keys (same as base)`);
    }
  }
}

// ─── 3. DEEP INSPECT /results with goals and halfTimeScore ───
async function inspectResultsDeep() {
  console.log('\n' + '='.repeat(80));
  console.log('3. DEEP INSPECT: /results — goals array & halfTimeScore');
  console.log('='.repeat(80));

  const leagues = ['8035', '8060', '8056'];
  for (const lid of leagues) {
    console.log(`\n--- League ${lid} ---`);
    const data = await fetchJSON(`/${lid}/results?skip=0&take=3`, `${lid}/results`);
    if (!data?.rounds) continue;

    for (const rd of data.rounds.slice(0, 1)) {
      console.log(`  Round ${rd.roundNumber}:`);
      for (const m of (rd.matches || []).slice(0, 3)) {
        console.log(`\n  ${m.homeTeam?.name} vs ${m.awayTeam?.name}`);
        console.log(`    score: ${m.score}`);
        console.log(`    halfTimeScore: ${m.halfTimeScore || 'N/A'}`);
        console.log(`    goals: ${JSON.stringify(m.goals || [])}`);
        console.log(`    expectedStart: ${m.expectedStart}`);
      }
    }
  }
}

// ─── 4. TIMING TEST: How fast does /results update? ───
async function timingTest() {
  console.log('\n' + '='.repeat(80));
  console.log('4. TIMING TEST: Compare /results latest round vs /matches current round');
  console.log('='.repeat(80));

  const leagues = [
    { id: '8035', name: 'English League' },
    { id: '8060', name: "Coupe d'Afrique" },
    { id: '8056', name: 'Champions League' },
  ];

  for (const league of leagues) {
    const [matchData, resultData] = await Promise.all([
      fetchJSON(`/${league.id}/matches`, `${league.name}/matches`),
      fetchJSON(`/${league.id}/results?skip=0&take=5`, `${league.name}/results`),
    ]);

    if (!matchData?.rounds || !resultData?.rounds) continue;

    // Current match round
    const matchRound = matchData.rounds.find(r => r.matches?.length > 0);
    const latestResultRound = resultData.rounds[0];

    console.log(`\n  ${league.name}:`);
    console.log(`    Current match round: ${matchRound?.roundNumber || '?'} (expectedStart: ${matchRound?.expectedStart || 'N/A'})`);
    console.log(`    Latest result round: ${latestResultRound?.roundNumber || '?'} (${latestResultRound?.expectedStart || 'N/A'})`);
    console.log(`    Gap: ${matchRound?.roundNumber && latestResultRound?.roundNumber ? matchRound.roundNumber - latestResultRound.roundNumber : '?'} rounds`);
    
    // Check all match rounds
    const allRoundNums = matchData.rounds.map(r => r.roundNumber);
    const allResultNums = resultData.rounds.map(r => r.roundNumber);
    console.log(`    Match rounds: ${allRoundNums.slice(0, 5).join(', ')}...`);
    console.log(`    Result rounds: ${allResultNums.slice(0, 5).join(', ')}...`);
  }
}

// ─── 5. EXPLOIT: Playout polling before expectedStart ───
async function playoutTimingExploit() {
  console.log('\n' + '='.repeat(80));
  console.log('5. EXPLOIT: Playout data available BEFORE expectedStart?');
  console.log('='.repeat(80));

  const leagues = ['8060']; // Coupe d'Afrique (was returning playout data)
  for (const lid of leagues) {
    console.log(`\n--- League ${lid} ---`);
    const matchData = await fetchJSON(`/${lid}/matches`, `${lid}/matches`);
    if (!matchData?.rounds) continue;

    const now = Date.now();
    
    for (const rd of matchData.rounds.slice(0, 10)) {
      if (!rd.eventCategoryId) continue;
      
      const startMs = new Date(rd.expectedStart).getTime();
      const diffSec = Math.round((startMs - now) / 1000);
      const status = diffSec > 0 ? `${diffSec}s BEFORE start` : `${Math.abs(diffSec)}s AFTER start`;
      
      // Try to get playout
      const params = `parentEventCategoryId=${lid}&eventCategoryId=${rd.eventCategoryId}`;
      const playout = await fetchJSON(`/round/${rd.roundNumber}/playout?${params}`, `playout-r${rd.roundNumber}`);
      
      const hasGoals = playout?.matches?.some(m => (m.goals?.length || 0) > 0);
      const goalInfo = playout?.matches ? 
        playout.matches.map(m => `${m.id}: ${m.goals?.length || 0} goals`).join(', ') : 'no data';
      
      console.log(`  Round ${rd.roundNumber}: ${status} | playout: ${playout ? `${playout.matches?.length || 0} matches` : 'N/A'} | hasGoals: ${hasGoals} | ${goalInfo}`);
    }
  }
}

// ─── 6. HALF-TIME SCORE in /results — early indicator? ───
async function halfTimeExploit() {
  console.log('\n' + '='.repeat(80));
  console.log('6. HALF-TIME SCORE EXPLOIT: Does /results show HT before match ends?');
  console.log('='.repeat(80));

  const lid = '8035';
  
  // Fetch repeatedly over 10 seconds to see if HT score appears before FT
  for (let i = 0; i < 3; i++) {
    const data = await fetchJSON(`/${lid}/results?skip=0&take=3`, `ht-check-${i}`);
    if (!data?.rounds) continue;

    for (const rd of data.rounds) {
      for (const m of (rd.matches || []).slice(0, 2)) {
        const goals = m.goals || [];
        const lastMin = goals.length > 0 ? goals[goals.length - 1].minute : 0;
        console.log(`  [${i}] Round ${rd.roundNumber}: ${m.homeTeam?.name} vs ${m.awayTeam?.name} | score=${m.score} HT=${m.halfTimeScore || 'N/A'} | lastGoalMin=${lastMin}`);
      }
    }
    
    await new Promise(r => setTimeout(r, 3000));
  }
}

// ─── RUN ALL ───
async function main() {
  console.log('==========================================================');
  console.log('DEEP API INSPECTION — Phase 2 (Hidden Data & Exploits)');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('==========================================================');

  await inspectEventBetTypes();
  await compareIncludeParams();
  await inspectResultsDeep();
  await timingTest();
  await playoutTimingExploit();
  await halfTimeExploit();

  console.log('\n=== PHASE 2 COMPLETE ===');
}

main().catch(console.error);
