#!/usr/bin/env node
/**
 * Aggressive Sporty API Scanner — Find ALL endpoints that return results/scores early
 * Tests: alt endpoints, query params, headers variations, timing tricks
 */
import https from 'https';
import fs from 'fs';

const B = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues';
const LEAGUE = '8035';
const LEAGUE2 = '8042';
let output = '';
let found = [];
let totalTests = 0;

function log(msg) { console.log(msg); output += msg + '\n'; }
function sep(c = '=', n = 80) { output += c.repeat(n) + '\n'; }

function fetchJSON(url, headers = {}, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = https.get(url, {
        headers: {
          'Origin': 'https://bet261.mg',
          'Referer': 'https://bet261.mg/',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'fr-FR,fr;q=0.9',
          'App-Version': '33470',
          ...headers,
        },
        timeout: timeoutMs,
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    } catch (e) { resolve({ status: 0, body: '' }); }
  });
}

function hasScoreFields(body) {
  if (!body || body.length < 10) return false;
  try {
    const j = JSON.parse(body);
    const s = JSON.stringify(j).toLowerCase();
    // Look for score-related fields
    return s.includes('homescore') || s.includes('awayscore') ||
           s.includes('score') || s.includes('goals') ||
           s.includes('winner') || s.includes('predetermined') ||
           s.includes('minute') || s.includes('result');
  } catch { return false; }
}

function extractMatchInfo(body) {
  try {
    const j = JSON.parse(body);
    const matches = [];
    
    function find(obj, depth = 0) {
      if (depth > 8 || !obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { obj.forEach(x => find(x, depth + 1)); return; }
      const keys = Object.keys(obj);
      if ((keys.some(k => /home/i.test(k)) && keys.some(k => /away/i.test(k))) || keys.includes('participants')) {
        matches.push(obj);
      }
      Object.values(obj).forEach(v => { if (typeof v === 'object') find(v, depth + 1); });
    }
    
    find(j);
    return matches;
  } catch { return []; }
}

async function testEndpoint(url, label, headers = {}) {
  totalTests++;
  const r = await fetchJSON(url, headers);
  const hasScores = hasScoreFields(r.body);
  const matches = hasScores ? extractMatchInfo(r.body) : [];
  
  const status = r.status;
  const len = r.body.length;
  const mark = hasScores ? '🎯' : (status === 200 ? '✓' : '✗');
  
  log(`[${mark}] ${label} → ${status} (${len}B)${hasScores ? ` [SCORES! ${matches.length} matches]` : ''}`);
  
  if (hasScores && matches.length > 0) {
    found.push({ url, label, status, body: r.body.substring(0, 3000), matches: matches.length });
    // Log first match details
    const m = matches[0];
    log(`  → ${JSON.stringify(m).substring(0, 500)}`);
  }
  
  return { status, hasScores, matchCount: matches.length };
}

async function main() {
  log('=== AGGRESSIVE SPORTY API SCANNER ===');
  log(`Time: ${new Date().toISOString()}`);
  log(`League: ${LEAGUE} (English League)`);
  sep('#');
  
  // First, get current matches to find active round info
  log('\n--- PHASE 0: DISCOVER ACTIVE ROUNDS ---');
  const matchesResp = await fetchJSON(`${B}/${LEAGUE}/matches`);
  let activeRound = null;
  let eventCategoryId = null;
  let activeMatchIds = new Set();
  
  if (matchesResp.status === 200) {
    try {
      const j = JSON.parse(matchesResp.body);
      if (j.rounds) {
        for (const rd of j.rounds) {
          const rn = rd.roundNumber;
          log(`  Round ${rn}: ${rd.matches?.length || 0} matches, catId=${rd.eventCategoryId || 'none'}, start=${rd.expectedStart || 'none'}`);
          
          // Check for betting matches
          for (const m of (rd.matches || [])) {
            const hasBetting = (m.eventBetTypes || []).some(bt =>
              (bt.eventBetTypeItems || []).some(it => it.active && it.bettingAllowed)
            );
            if (hasBetting) {
              activeMatchIds.add(m.id);
              if (!activeRound) {
                activeRound = rn;
                eventCategoryId = rd.eventCategoryId;
                log(`  → BETTING ROUND: ${rn}, eventCategoryId: ${eventCategoryId}`);
              }
            }
          }
        }
      }
    } catch (e) { log(`  Parse error: ${e.message}`); }
  }
  
  // ===== PHASE 1: KNOWN ENDPOINTS (comprehensive) =====
  log('\n--- PHASE 1: KNOWN ENDPOINTS ---');
  await testEndpoint(`${B}/${LEAGUE}/matches`, `${LEAGUE}/matches`);
  await testEndpoint(`${B}/${LEAGUE}/results?skip=0&take=200`, `${LEAGUE}/results`);
  await testEndpoint(`${B}/${LEAGUE}/ranking`, `${LEAGUE}/ranking`);
  
  // Playout for all rounds we know about
  if (activeRound) {
    for (let r = Math.max(1, activeRound - 5); r <= activeRound + 2; r++) {
      const catParam = eventCategoryId ? `&eventCategoryId=${eventCategoryId}` : '';
      await testEndpoint(
        `${B}/round/${r}/playout?parentEventCategoryId=${LEAGUE}${catParam}`,
        `round/${r}/playout (cat=${eventCategoryId ? 'yes' : 'no'})`
      );
      await testEndpoint(
        `${B}/round/${r}/playout?parentEventCategoryId=${LEAGUE}`,
        `round/${r}/playout (no catId)`
      );
    }
  }
  
  // ===== PHASE 2: ALTERNATIVE ENDPOINT PATTERNS =====
  log('\n--- PHASE 2: ALTERNATIVE PATTERNS ---');
  
  const altPatterns = [
    `/${LEAGUE}/live`, `/${LEAGUE}/live/matches`, `/${LEAGUE}/live/scores`,
    `/${LEAGUE}/live/events`, `/${LEAGUE}/live/playout?parentEventCategoryId=${LEAGUE}`,
    `/${LEAGUE}/live/standings`, `/${LEAGUE}/scores`, `/${LEAGUE}/fixtures`,
    `/${LEAGUE}/events`, `/${LEAGUE}/schedule`, `/${LEAGUE}/rounds`,
    `/${LEAGUE}/rounds/current`, `/${LEAGUE}/current`,
    `/${LEAGUE}/playout`, `/${LEAGUE}/prematch`,
    `/${LEAGUE}/highlights`, `/${LEAGUE}/incidents`,
    `/${LEAGUE}/statistics`, `/${LEAGUE}/odds`,
    `/${LEAGUE}/markets`, `/${LEAGUE}/bettypes`,
    `/${LEAGUE}/standings`, `/${LEAGUE}/table`,
    `/${LEAGUE}/topscorers`, `/${LEAGUE}/players`,
    `/${LEAGUE}/teams`, `/${LEAGUE}/season`,
    `/${LEAGUE}/info`, `/${LEAGUE}/config`,
    `/${LEAGUE}/metadata`, `/${LEAGUE}/liveodds`,
    `/${LEAGUE}/lineup`, `/${LEAGUE}/lineups`,
    `/${LEAGUE}/commentary`, `/${LEAGUE}/status`,
  ];
  
  for (const ep of altPatterns) {
    await testEndpoint(B + ep, ep);
  }
  
  // ===== PHASE 3: ROUND-LEVEL ALTERNATIVES =====
  log('\n--- PHASE 3: ROUND-LEVEL ALTERNATIVES ---');
  
  if (activeRound) {
    const roundAlts = [
      `/round/${activeRound}/schedule?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/results?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/live?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/matches?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/scores?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/events?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/incidents?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/statistics?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/highlights?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/lineup?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/commentary?parentEventCategoryId=${LEAGUE}`,
      `/round/${activeRound}/odds?parentEventCategoryId=${LEAGUE}`,
    ];
    
    for (const ep of roundAlts) {
      await testEndpoint(B + ep, ep);
    }
    
    // Also test with eventCategoryId
    if (eventCategoryId) {
      const withCat = [
        `/round/${activeRound}/schedule?parentEventCategoryId=${LEAGUE}&eventCategoryId=${eventCategoryId}`,
        `/round/${activeRound}/results?parentEventCategoryId=${LEAGUE}&eventCategoryId=${eventCategoryId}`,
        `/round/${activeRound}/live?parentEventCategoryId=${LEAGUE}&eventCategoryId=${eventCategoryId}`,
        `/round/${activeRound}/matches?parentEventCategoryId=${LEAGUE}&eventCategoryId=${eventCategoryId}`,
        `/round/${activeRound}/scores?parentEventCategoryId=${LEAGUE}&eventCategoryId=${eventCategoryId}`,
      ];
      
      for (const ep of withCat) {
        await testEndpoint(B + ep, ep);
      }
    }
  }
  
  // ===== PHASE 4: ALTERNATIVE URL STRUCTURES =====
  log('\n--- PHASE 4: ALT URL STRUCTURES ---');
  
  const altUrls = [
    `${B}/parentEventCategoryId/${LEAGUE}/matches`,
    `${B}/parentEventCategoryId/${LEAGUE}/playout`,
    `${B}/parentEventCategoryId/${LEAGUE}/results`,
    `${B}/parentEventCategoryId/${LEAGUE}/live`,
    `${B}/parentEventCategoryId/${LEAGUE}/scores`,
    `${B}/league/${LEAGUE}/matches`,
    `${B}/league/${LEAGUE}/playout`,
    `${B}/league/${LEAGUE}/results`,
    `${B}/eventCategory/${LEAGUE}/matches`,
    `${B}/eventCategory/${LEAGUE}/playout`,
    `${B}/eventCategory/${LEAGUE}/results`,
  ];
  
  for (const url of altUrls) {
    const label = url.replace(B, '');
    await testEndpoint(url, label);
  }
  
  // ===== PHASE 5: ALTERNATIVE BASE URLS =====
  log('\n--- PHASE 5: ALT BASE URLS ---');
  
  const altBases = [
    `https://hg-event-api-prod.sporty-tech.net/api/v1/instantleagues/${LEAGUE}/matches`,
    `https://hg-event-api-prod.sporty-tech.net/api/v2/instantleagues/${LEAGUE}/matches`,
    `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/v1/${LEAGUE}/matches`,
    `https://event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE}/matches`,
    `https://api.sporty-tech.net/api/instantleagues/${LEAGUE}/matches`,
  ];
  
  for (const url of altBases) {
    await testEndpoint(url, url.replace('https://', '').substring(0, 60));
  }
  
  // ===== PHASE 6: MATCH-LEVEL ENDPOINTS =====
  log('\n--- PHASE 6: MATCH-LEVEL ENDPOINTS ---');
  
  // Get a match ID from active matches
  let matchId = null;
  if (activeMatchIds.size > 0) {
    matchId = [...activeMatchIds][0];
    log(`  Testing with matchId: ${matchId}`);
    
    const matchEndpoints = [
      `/${LEAGUE}/match/${matchId}`,
      `/${LEAGUE}/match/${matchId}/playout`,
      `/${LEAGUE}/match/${matchId}/score`,
      `/${LEAGUE}/match/${matchId}/results`,
      `/${LEAGUE}/match/${matchId}/live`,
      `/${LEAGUE}/match/${matchId}/incidents`,
      `/${LEAGUE}/match/${matchId}/statistics`,
      `/${LEAGUE}/match/${matchId}/lineup`,
      `/match/${matchId}?parentEventCategoryId=${LEAGUE}`,
      `/match/${matchId}/playout?parentEventCategoryId=${LEAGUE}`,
      `/event/${matchId}?parentEventCategoryId=${LEAGUE}`,
      `/event/${matchId}/playout?parentEventCategoryId=${LEAGUE}`,
    ];
    
    for (const ep of matchEndpoints) {
      await testEndpoint(B + ep, ep);
    }
  }
  
  // ===== PHASE 7: QUERY PARAM VARIATIONS =====
  log('\n--- PHASE 7: QUERY PARAM VARIATIONS ---');
  
  const queryParams = [
    `/${LEAGUE}/matches?include=results`,
    `/${LEAGUE}/matches?include=playout`,
    `/${LEAGUE}/matches?include=scores`,
    `/${LEAGUE}/matches?include=goals`,
    `/${LEAGUE}/matches?withResults=true`,
    `/${LEAGUE}/matches?withScores=true`,
    `/${LEAGUE}/matches?expand=results`,
    `/${LEAGUE}/matches?expand=playout`,
    `/${LEAGUE}/matches?details=true`,
    `/${LEAGUE}/matches?full=true`,
    `/${LEAGUE}/matches?extended=true`,
    `/${LEAGUE}/matches?verbose=true`,
    `/${LEAGUE}/results?leagueId=${LEAGUE}`,
    `/${LEAGUE}/results?take=500`,
    `/${LEAGUE}/results?skip=0&take=500`,
    `/${LEAGUE}/playout?round=${activeRound || 1}`,
    `/${LEAGUE}/playout?parentEventCategoryId=${LEAGUE}`,
  ];
  
  for (const ep of queryParams) {
    await testEndpoint(B + ep, ep);
  }
  
  // ===== PHASE 8: HEADER VARIATIONS =====
  log('\n--- PHASE 8: HEADER VARIATIONS ---');
  
  // Test with different App-Version values
  const versions = ['33470', '33335', '33000', '32000', '31000', '30000', '29000'];
  for (const v of versions) {
    await testEndpoint(
      `${B}/${LEAGUE}/matches`,
      `matches (App-Version: ${v})`,
      { 'App-Version': v }
    );
  }
  
  // Test with Bearer token variations (even without real token)
  await testEndpoint(
    `${B}/${LEAGUE}/matches`,
    'matches (with fake Bearer)',
    { 'Authorization': 'Bearer test-token-12345' }
  );
  
  // ===== PHASE 9: SECOND LEAGUE VERIFICATION =====
  log('\n--- PHASE 9: SECOND LEAGUE CHECK ---');
  await testEndpoint(`${B}/${LEAGUE2}/matches`, `${LEAGUE2}/matches`);
  if (activeRound) {
    await testEndpoint(
      `${B}/round/${activeRound}/playout?parentEventCategoryId=${LEAGUE2}`,
      `${LEAGUE2} round/${activeRound}/playout`
    );
  }
  
  // ===== PHASE 10: DEEP PLOUT ANALYSIS =====
  log('\n--- PHASE 10: DEEP PLOUT ANALYSIS ---');
  
  if (activeRound && eventCategoryId) {
    const playoutUrl = `${B}/round/${activeRound}/playout?parentEventCategoryId=${LEAGUE}&eventCategoryId=${eventCategoryId}`;
    const pr = await fetchJSON(playoutUrl);
    
    if (pr.status === 200 && pr.body.length > 10) {
      log(`\n  Full playout response for round ${activeRound}:`);
      try {
        const pj = JSON.parse(pr.body);
        log(`  Keys: ${Object.keys(pj).join(', ')}`);
        if (pj.matches) {
          log(`  Matches count: ${pj.matches.length}`);
          for (const m of pj.matches.slice(0, 5)) {
            const goals = m.goals || [];
            const lastGoal = goals[goals.length - 1] || {};
            log(`  Match ${m.id}: ${m.homeTeam?.name || '?'} vs ${m.awayTeam?.name || '?'} → ${lastGoal.homeScore || 0}-${lastGoal.awayScore || 0} (min=${lastGoal.minute || '?'})`);
            if (goals.length > 0) {
              log(`    Goals timeline: ${JSON.stringify(goals)}`);
            }
            // Check ALL fields on match object
            const extraKeys = Object.keys(m).filter(k => !['homeTeam', 'awayTeam', 'goals'].includes(k));
            if (extraKeys.length > 0) {
              log(`    Extra fields: ${extraKeys.join(', ')}`);
              for (const k of extraKeys) {
                log(`      ${k}: ${JSON.stringify(m[k]).substring(0, 200)}`);
              }
            }
          }
        }
      } catch (e) { log(`  Parse error: ${e.message}`); }
    }
    
    // Also test playout for neighboring rounds
    log('\n  Playout for surrounding rounds:');
    for (let r = Math.max(1, activeRound - 3); r <= activeRound + 1; r++) {
      const url = `${B}/round/${r}/playout?parentEventCategoryId=${LEAGUE}&eventCategoryId=${eventCategoryId}`;
      const rr = await fetchJSON(url);
      if (rr.status === 200 && rr.body.length > 5) {
        try {
          const rj = JSON.parse(rr.body);
          const matchCount = rj.matches?.length || 0;
          const overlapCount = rj.matches ? rj.matches.filter(m => activeMatchIds.has(m.id)).length : 0;
          log(`    Round ${r}: ${matchCount} matches, ${overlapCount} overlap with betting`);
          
          // Check if these are FINAL scores (minute=90) or in-progress
          if (matchCount > 0) {
            for (const m of rj.matches.slice(0, 2)) {
              const goals = m.goals || [];
              const last = goals[goals.length - 1] || {};
              const isBetting = activeMatchIds.has(m.id);
              log(`      ${m.homeTeam?.name} vs ${m.awayTeam?.name}: ${last.homeScore || 0}-${last.awayScore || 0} (min=${last.minute || '?'}) ${isBetting ? '[BETTING ACTIVE!]' : ''}`);
            }
          }
        } catch {}
      } else {
        log(`    Round ${r}: ${rr.status} (${rr.body.length}B)`);
      }
    }
  }
  
  // ===== SUMMARY =====
  sep('#');
  log(`\n=== SCAN COMPLETE ===`);
  log(`Total endpoints tested: ${totalTests}`);
  log(`Endpoints with score data: ${found.length}`);
  
  if (found.length > 0) {
    log('\n--- FOUND ENDPOINTS ---');
    for (const f of found) {
      log(`\n🎯 ${f.label}`);
      log(`   URL: ${f.url}`);
      log(`   Matches: ${f.matches}`);
    }
  }
  
  // Save results
  fs.writeFileSync('/home/z/my-project/download/api-scan-results.txt', output, 'utf-8');
  log(`\nResults saved to: /home/z/my-project/download/api-scan-results.txt`);
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  fs.writeFileSync('/home/z/my-project/download/api-scan-results.txt', output, 'utf-8');
});
