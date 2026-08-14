// Deep API inspection — all endpoints, all leagues, all hidden fields
// Goal: find ANY data that reveals results before official finalization

const API_BASE = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues';
const HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'fr',
  'app-version': '33470',
  'referer': 'https://bet261.mg/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
};

const LEAGUES = [
  { id: '8035', name: 'English League' },
  { id: '8060', name: "Coupe d'Afrique" },
  { id: '8056', name: 'Champions League' },
  { id: '8036', name: 'Italian League' },
  { id: '8037', name: 'Spanish League' },
  { id: '8042', name: 'French League' },
  { id: '8043', name: 'German League' },
  { id: '8044', name: 'Portuguese League' },
  { id: '8065', name: 'Coupe du monde' },
];

async function fetchJSON(path, label) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    console.log(`  [${label}] Status: ${res.status} ${res.statusText}`);
    if (!res.ok) return null;
    const data = await res.json();
    console.log(`  [${label}] Response size: ${JSON.stringify(data).length} chars`);
    return data;
  } catch (e) {
    console.log(`  [${label}] ERROR: ${e.message}`);
    return null;
  }
}

// Recursively extract all unique keys from nested objects
function extractAllKeys(obj, prefix = '', depth = 0) {
  if (depth > 5) return new Set();
  const keys = new Set();
  if (!obj || typeof obj !== 'object') return keys;
  
  if (Array.isArray(obj)) {
    // Sample first 3 elements
    for (const item of obj.slice(0, 3)) {
      for (const k of extractAllKeys(item, '', depth + 1)) keys.add(k);
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      keys.add(fullKey);
      for (const k of extractAllKeys(value, fullKey, depth + 1)) keys.add(k);
    }
  }
  return keys;
}

// ─── 1. DEEP INSPECT /matches ───
async function inspectMatches() {
  console.log('\n' + '='.repeat(80));
  console.log('1. DEEP INSPECT: /{leagueId}/matches');
  console.log('='.repeat(80));

  for (const league of LEAGUES) {
    console.log(`\n--- ${league.name} (${league.id}) ---`);
    const data = await fetchJSON(`/${league.id}/matches`, `${league.name}/matches`);
    if (!data) continue;

    // Extract ALL keys from the full structure
    const allKeys = extractAllKeys(data);
    console.log(`  ALL KEYS (${allKeys.size}):`);
    for (const k of [...allKeys].sort()) console.log(`    - ${k}`);

    // Look at rounds structure
    if (data.rounds) {
      for (const rd of data.rounds) {
        console.log(`\n  Round ${rd.roundNumber || '?'}:`);
        console.log(`    Keys: ${Object.keys(rd).join(', ')}`);
        console.log(`    expectedStart: ${rd.expectedStart || 'N/A'}`);
        console.log(`    eventCategoryId: ${rd.eventCategoryId || 'N/A'}`);
        console.log(`    eventCategoryName: ${rd.eventCategoryName || 'N/A'}`);
        console.log(`    status: ${rd.status || 'N/A'}`);
        
        // Match details
        if (rd.matches) {
          for (const m of rd.matches.slice(0, 2)) {
            console.log(`\n    Match: ${m.homeTeam?.name || '?'} vs ${m.awayTeam?.name || '?'}`);
            console.log(`      Match ID: ${m.id}`);
            console.log(`      All keys: ${Object.keys(m).join(', ')}`);
            
            // Bets/Odds inspection
            if (m.bets) {
              console.log(`      Bets (${m.bets.length} total):`);
              for (const bet of m.bets) {
                if (bet.odd && bet.odd < 5) {
                  console.log(`        [ODD ${bet.odd?.toFixed(2)}] type=${bet.betTypeName || bet.type || '?'} name="${bet.betName || '?'}" outcome="${bet.outcomeName || bet.outcome || '?'}"`);
                }
              }
            }
            
            // Look for hidden score fields
            if (m.score !== undefined) console.log(`      score: ${m.score}`);
            if (m.goals) console.log(`      goals: ${JSON.stringify(m.goals).substring(0, 200)}`);
            if (m.result) console.log(`      result: ${JSON.stringify(m.result)}`);
            if (m.liveData) console.log(`      liveData: ${JSON.stringify(m.liveData).substring(0, 300)}`);
            if (m.statistics) console.log(`      statistics: ${JSON.stringify(m.statistics).substring(0, 200)}`);
            if (m.extraData) console.log(`      extraData: ${JSON.stringify(m.extraData).substring(0, 200)}`);
            if (m.metaData) console.log(`      metaData: ${JSON.stringify(m.metaData).substring(0, 200)}`);
            if (m.additionalData) console.log(`      additionalData: ${JSON.stringify(m.additionalData).substring(0, 200)}`);
          }
        }
      }
    }
  }
}

// ─── 2. DEEP INSPECT /results ───
async function inspectResults() {
  console.log('\n' + '='.repeat(80));
  console.log('2. DEEP INSPECT: /{leagueId}/results');
  console.log('='.repeat(80));

  for (const league of LEAGUES.slice(0, 3)) { // First 3 leagues
    console.log(`\n--- ${league.name} (${league.id}) ---`);
    const data = await fetchJSON(`/${league.id}/results?skip=0&take=5`, `${league.name}/results`);
    if (!data) continue;

    const allKeys = extractAllKeys(data);
    console.log(`  ALL KEYS (${allKeys.size}):`);
    for (const k of [...allKeys].sort()) console.log(`    - ${k}`);

    if (data.rounds) {
      for (const rd of data.rounds.slice(0, 2)) {
        console.log(`\n  Round ${rd.roundNumber}:`);
        console.log(`    Keys: ${Object.keys(rd).join(', ')}`);
        if (rd.matches) {
          for (const m of rd.matches.slice(0, 2)) {
            console.log(`    ${m.homeTeam?.name} vs ${m.awayTeam?.name}`);
            console.log(`      Keys: ${Object.keys(m).join(', ')}`);
            console.log(`      score: ${m.score}`);
            if (m.bets) {
              console.log(`      bets count: ${m.bets?.length}`);
            }
          }
        }
      }
    }
  }
}

// ─── 3. DEEP INSPECT /playout ───
async function inspectPlayout() {
  console.log('\n' + '='.repeat(80));
  console.log('3. DEEP INSPECT: /round/{round}/playout');
  console.log('='.repeat(80));

  // First get current rounds from matches
  for (const league of LEAGUES.slice(0, 3)) {
    console.log(`\n--- ${league.name} (${league.id}) ---`);
    const matchData = await fetchJSON(`/${league.id}/matches`, `${league.name}/matches-for-round`);
    if (!matchData?.rounds) continue;

    // Get the FIRST round (most recent)
    const rd = matchData.rounds[0];
    if (!rd?.roundNumber) continue;
    
    const roundNum = rd.roundNumber;
    const catId = rd.eventCategoryId || '';
    const params = `parentEventCategoryId=${league.id}${catId ? `&eventCategoryId=${catId}` : ''}`;
    
    console.log(`  Fetching playout for round ${roundNum} (params: ${params})`);
    const playout = await fetchJSON(`/round/${roundNum}/playout?${params}`, `${league.name}/playout`);
    if (!playout) continue;

    const allKeys = extractAllKeys(playout);
    console.log(`  ALL KEYS (${allKeys.size}):`);
    for (const k of [...allKeys].sort()) console.log(`    - ${k}`);

    // Check match structure
    if (playout.matches) {
      for (const m of playout.matches.slice(0, 3)) {
        console.log(`\n  Playout Match: ${m.homeTeam?.name || '?'} vs ${m.awayTeam?.name || '?'}`);
        console.log(`    ID: ${m.id}`);
        console.log(`    Keys: ${Object.keys(m).join(', ')}`);
        console.log(`    goals: ${JSON.stringify(m.goals || [])}`);
        if (m.score) console.log(`    score: ${m.score}`);
        if (m.status) console.log(`    status: ${m.status}`);
        if (m.bettingMatchId) console.log(`    bettingMatchId: ${m.bettingMatchId}`);
        if (m.bettingMatchIds) console.log(`    bettingMatchIds: ${JSON.stringify(m.bettingMatchIds)}`);
        if (m.externalId) console.log(`    externalId: ${m.externalId}`);
        if (m.source) console.log(`    source: ${m.source}`);
      }
    }
  }
}

// ─── 4. DEEP INSPECT /ranking ───
async function inspectRanking() {
  console.log('\n' + '='.repeat(80));
  console.log('4. DEEP INSPECT: /{leagueId}/ranking');
  console.log('='.repeat(80));

  for (const league of LEAGUES.slice(0, 3)) {
    console.log(`\n--- ${league.name} (${league.id}) ---`);
    const data = await fetchJSON(`/${league.id}/ranking`, `${league.name}/ranking`);
    if (!data) continue;

    const allKeys = extractAllKeys(data);
    console.log(`  ALL KEYS (${allKeys.size}):`);
    for (const k of [...allKeys].sort()) console.log(`    - ${k}`);
    
    if (data.teams) {
      for (const t of data.teams.slice(0, 3)) {
        console.log(`  ${t.name || t.teamName || '?'}: ${JSON.stringify(t).substring(0, 200)}`);
      }
    }
  }
}

// ─── 5. SCAN UNDOCUMENTED ENDPOINTS ───
async function scanUndocumented() {
  console.log('\n' + '='.repeat(80));
  console.log('5. SCAN UNDOCUMENTED ENDPOINTS & QUERY PARAMS');
  console.log('='.repeat(80));

  const testPaths = [
    '/8035/schedule',
    '/8035/fixtures',
    '/8035/scores',
    '/8035/live',
    '/8035/highlights',
    '/8035/odds',
    '/8035/events',
    '/8035/rounds',
    '/8035/current',
    '/8035/upcoming',
    '/8035/next',
    '/8035/stats',
    '/8035/standings',
    '/8035/table',
    '/8035/round/1',
    '/8035/round/1/matches',
    '/8035/round/1/results',
    '/8035/round/1/score',
    '/8035/round/1/play',
    '/8035/matches?include=results',
    '/8035/matches?include=bets',
    '/8035/matches?include=odds',
    '/8035/matches?include=scores',
    '/8035/matches?include=playout',
    '/8035/matches?detailed=true',
    '/8035/matches?full=true',
    '/8035/matches?all=true',
    '/8035/results?round=1',
    '/8035/results?current=true',
    '/8035/results?live=true',
    '/round/1/matches?parentEventCategoryId=8035',
    '/round/1/results?parentEventCategoryId=8035',
    '/round/1/score?parentEventCategoryId=8035',
    '/8035/round/1/playout?parentEventCategoryId=8035',
    '/8035/playout',
    '/8035/prematch',
    '/8035/predictions',
    '/8035/live/odds',
    '/8035/betting',
  ];

  for (const path of testPaths) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(5000),
      });
      if (res.status !== 404) {
        console.log(`  FOUND: ${path} → ${res.status} ${res.statusText}`);
        try {
          const data = await res.json();
          const preview = JSON.stringify(data).substring(0, 300);
          console.log(`    Preview: ${preview}`);
        } catch { /* not JSON */ }
      }
    } catch { /* timeout or network */ }
  }

  // Also test with different API base paths
  const altBases = [
    'https://hg-event-api-prod.sporty-tech.net/api',
    'https://hg-event-api-prod.sporty-tech.net',
    'https://hg-event-api-prod.sporty-tech.net/api/instantleagues/8035',
  ];
  const altPaths = ['/status', '/health', '/info', '/endpoints', '/docs', '/api'];
  
  for (const base of altBases) {
    for (const path of altPaths) {
      try {
        const res = await fetch(`${base}${path}`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(4000),
        });
        if (res.status !== 404 && res.status !== 403) {
          console.log(`  ALT FOUND: ${base}${path} → ${res.status}`);
        }
      } catch { /* skip */ }
    }
  }
}

// ─── 6. CROSS-REFERENCE: bettingMatchIds in matches vs playout ───
async function crossReferenceExploit() {
  console.log('\n' + '='.repeat(80));
  console.log('6. CROSS-REFERENCE EXPLOIT: matches.bettingMatchIds ∩ playout');
  console.log('='.repeat(80));

  for (const league of LEAGUES.slice(0, 5)) {
    console.log(`\n--- ${league.name} (${league.id}) ---`);
    
    // Get matches
    const matchData = await fetchJSON(`/${league.id}/matches`, `${league.name}/matches-xref`);
    if (!matchData?.rounds) continue;

    const rd = matchData.rounds[0];
    if (!rd?.roundNumber) continue;
    
    // Extract bettingMatchIds from matches
    const bettingMatchIds = new Set();
    const matchIds = new Set();
    for (const m of rd.matches || []) {
      if (m.id) matchIds.add(m.id);
      if (m.bettingMatchId) bettingMatchIds.add(String(m.bettingMatchId));
      if (m.bettingMatchIds) {
        for (const id of m.bettingMatchIds) bettingMatchIds.add(String(id));
      }
    }

    console.log(`  Round ${rd.roundNumber}: ${matchIds.size} match IDs, ${bettingMatchIds.size} bettingMatchIds`);
    if (bettingMatchIds.size > 0) {
      console.log(`  bettingMatchIds: ${[...bettingMatchIds].join(', ')}`);
    }

    // Get playout for same round
    const catId = rd.eventCategoryId || '';
    const params = `parentEventCategoryId=${league.id}${catId ? `&eventCategoryId=${catId}` : ''}`;
    const playout = await fetchJSON(`/round/${rd.roundNumber}/playout?${params}`, `${league.name}/playout-xref`);
    
    if (playout?.matches) {
      const playoutIds = new Set();
      const playoutBettingIds = new Set();
      for (const m of playout.matches) {
        if (m.id) playoutIds.add(m.id);
        if (m.bettingMatchId) playoutBettingIds.add(String(m.bettingMatchId));
        if (m.bettingMatchIds) {
          for (const id of m.bettingMatchIds) playoutBettingIds.add(String(id));
        }
      }

      console.log(`  Playout: ${playoutIds.size} match IDs, ${playoutBettingIds.size} bettingMatchIds`);

      // Find INTERSECTION — matches that exist in BOTH
      const intersection = [...bettingMatchIds].filter(id => playoutBettingIds.has(id));
      if (intersection.length > 0) {
        console.log(`  *** INTERSECTION (${intersection.length}): ${intersection.join(', ')} ***`);
        
        // Show the playout data for intersected matches
        for (const m of playout.matches) {
          const mBettingIds = [m.bettingMatchId, ...(m.bettingMatchIds || [])].map(String);
          if (mBettingIds.some(id => intersection.includes(id))) {
            console.log(`  EXPLOIT MATCH: ${m.homeTeam?.name} vs ${m.awayTeam?.name}`);
            console.log(`    goals: ${JSON.stringify(m.goals || [])}`);
            console.log(`    ID: ${m.id}, bettingMatchId: ${m.bettingMatchId}`);
          }
        }
      } else {
        console.log(`  No intersection found`);
      }
    }
  }
}

// ─── 7. ODDS ANALYSIS: "Score Exact" prediction ───
async function oddsAnalysis() {
  console.log('\n' + '='.repeat(80));
  console.log('7. ODDS ANALYSIS: Score Exact (lowest odd = probable result)');
  console.log('='.repeat(80));

  for (const league of LEAGUES.slice(0, 5)) {
    console.log(`\n--- ${league.name} (${league.id}) ---`);
    const data = await fetchJSON(`/${league.id}/matches`, `${league.name}/odds`);
    if (!data?.rounds) continue;

    for (const rd of data.rounds) {
      for (const m of rd.matches || []) {
        const scoreExactBets = (m.bets || []).filter(b => 
          (b.betTypeName || b.type || '').toLowerCase().includes('score') ||
          (b.betName || '').toLowerCase().includes('exact')
        );

        if (scoreExactBets.length > 0) {
          // Find lowest odd
          const sorted = scoreExactBets
            .filter(b => b.odd && b.odd > 1)
            .sort((a, b) => a.odd - b.odd);
          
          if (sorted.length > 0) {
            const top3 = sorted.slice(0, 3);
            console.log(`  ${m.homeTeam?.name} vs ${m.awayTeam?.name} (ID: ${m.id}):`);
            for (const t of top3) {
              console.log(`    [${t.odd?.toFixed(2)}] "${t.outcomeName || t.outcome || '?'}" type=${t.betTypeName || t.type}`);
            }
          }
        }
      }
    }
  }
}

// ─── RUN ALL ───
async function main() {
  console.log('==========================================================');
  console.log('DEEP API INSPECTION — Finding early result exploits');
  console.log('==========================================================');
  console.log(`Time: ${new Date().toISOString()}`);

  await inspectMatches();
  await inspectResults();
  await inspectPlayout();
  await inspectRanking();
  await scanUndocumented();
  await crossReferenceExploit();
  await oddsAnalysis();

  console.log('\n' + '='.repeat(80));
  console.log('INSPECTION COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
