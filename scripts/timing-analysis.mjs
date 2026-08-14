#!/usr/bin/env node
/**
 * Timing Analysis: When do playout results appear relative to expectedStart?
 * Polls /matches + /playout every 2s to track the exact moment scores appear
 */
import https from 'https';
import fs from 'fs';

const B = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues';
const LEAGUES = ['8035', '8042', '8037', '8036', '8043', '8056', '8060', '8044', '8065'];
let output = '';

function log(msg) { console.log(msg); output += msg + '\n'; }

function fetchJSON(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const req = https.get(url, {
        headers: {
          'Origin': 'https://bet261.mg',
          'Referer': 'https://bet261.mg/',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'fr-FR,fr;q=0.9',
          'App-Version': '33470',
        },
        timeout: timeoutMs,
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    } catch { resolve({ status: 0, body: '' }); }
  });
}

function parseJson(body) {
  try { return JSON.parse(body); } catch { return null; }
}

async function main() {
  log('=== TIMING ANALYSIS: PLOUT vs MATCHES ===');
  log(`Start: ${new Date().toISOString()}`);
  
  // Phase 1: Find the betting round for each league
  log('\n--- PHASE 1: DISCOVER ALL ACTIVE ROUNDS ---\n');
  
  const activeRounds = [];
  
  for (const leagueId of LEAGUES) {
    const r = await fetchJSON(`${B}/${leagueId}/matches`);
    if (r.status !== 200) continue;
    const j = parseJson(r.body);
    if (!j?.rounds) continue;
    
    for (const rd of j.rounds) {
      const matches = rd.matches || [];
      if (matches.length === 0) continue;
      
      let hasBetting = false;
      const bettingMatchIds = new Set();
      let matchNames = [];
      
      for (const m of matches) {
        const isBetting = (m.eventBetTypes || []).some(bt =>
          (bt.eventBetTypeItems || []).some(it => it.active && it.bettingAllowed)
        );
        if (isBetting) {
          hasBetting = true;
          bettingMatchIds.add(m.id);
          matchNames.push(`${m.homeTeam?.name || '?'} vs ${m.awayTeam?.name || '?'}`);
        }
      }
      
      activeRounds.push({
        leagueId,
        round: rd.roundNumber,
        eventCategoryId: rd.eventCategoryId,
        expectedStart: rd.expectedStart,
        expectedEnd: rd.expectedEnd,
        matchCount: matches.length,
        bettingMatchIds,
        hasBetting,
        matchNames: matchNames.slice(0, 3),
      });
      
      const bettingMark = hasBetting ? '🔴 BETTING' : '⚪ no-betting';
      const startStr = rd.expectedStart || 'none';
      const now = Date.now();
      const startMs = new Date(startStr).getTime();
      const diff = startMs - now;
      const timeStr = diff > 0 ? `in ${Math.round(diff/1000)}s` : `${Math.round(-diff/1000)}s ago`;
      
      log(`  ${leagueId} Round ${rd.roundNumber}: ${matches.length} matches | ${bettingMark} | start=${startStr} (${timeStr}) | catId=${rd.eventCategoryId || 'none'}`);
      if (matchNames.length > 0) {
        for (const n of matchNames) {
          log(`    ${n}${bettingMatchIds.size > 0 ? ' [BETTING]' : ''}`);
        }
      }
    }
  }
  
  // Phase 2: Check playout for all active rounds
  log('\n--- PHASE 2: PLOUT AVAILABILITY ---\n');
  
  for (const ar of activeRounds) {
    const catParam = ar.eventCategoryId ? `&eventCategoryId=${ar.eventCategoryId}` : '';
    const playoutUrl = `${B}/round/${ar.round}/playout?parentEventCategoryId=${ar.leagueId}${catParam}`;
    const pr = await fetchJSON(playoutUrl);
    
    if (pr.status === 200) {
      const pj = parseJson(pr.body);
      const playoutMatches = pj?.matches || [];
      
      // Find overlap with betting matches
      const overlap = playoutMatches.filter(m => ar.bettingMatchIds.has(m.id));
      
      log(`  ${ar.leagueId} Round ${ar.round} playout: ${playoutMatches.length} total, ${overlap.length} overlap with betting`);
      
      if (overlap.length > 0) {
        log(`  🎯🎯🎯 EXPLOIT ACTIVE! ${overlap.length} betting matches have scores in playout!`);
        for (const m of overlap) {
          const goals = m.goals || [];
          const last = goals[goals.length - 1] || {};
          log(`    ${m.homeTeam?.name} vs ${m.awayTeam?.name}: ${last.homeScore || 0}-${last.awayScore || 0} (min=${last.minute || '?'}, ${goals.length} goals)`);
        }
      }
      
      // Show all playout matches (not just overlap)
      if (playoutMatches.length > 0) {
        log(`  All playout matches for ${ar.leagueId} round ${ar.round}:`);
        for (const m of playoutMatches.slice(0, 20)) {
          const goals = m.goals || [];
          const last = goals[goals.length - 1] || {};
          const isBetting = ar.bettingMatchIds.has(m.id);
          const mark = isBetting ? '🔴' : '⚪';
          log(`    ${mark} ${m.homeTeam?.name} vs ${m.awayTeam?.name}: ${last.homeScore || 0}-${last.awayScore || 0} (min=${last.minute || '?'}) id=${m.id}`);
        }
        if (playoutMatches.length > 20) log(`    ... +${playoutMatches.length - 20} more`);
      }
    } else {
      log(`  ${ar.leagueId} Round ${ar.round} playout: HTTP ${pr.status} (${pr.body.length}B)`);
    }
  }
  
  // Phase 3: Check "Score exact" market for betting matches
  log('\n--- PHASE 3: CORRECT SCORE MARKET ANALYSIS ---\n');
  
  for (const ar of activeRounds.filter(r => r.hasBetting)) {
    const r = await fetchJSON(`${B}/${ar.leagueId}/matches`);
    if (r.status !== 200) continue;
    const j = parseJson(r.body);
    if (!j?.rounds) continue;
    
    for (const rd of j.rounds) {
      if (rd.roundNumber !== ar.round) continue;
      
      for (const m of (rd.matches || []).slice(0, 5)) {
        const isBetting = (m.eventBetTypes || []).some(bt =>
          (bt.eventBetTypeItems || []).some(it => it.active && it.bettingAllowed)
        );
        if (!isBetting) continue;
        
        let scoreExactPrediction = null;
        for (const bt of (m.eventBetTypes || [])) {
          const name = (bt.name || '').toLowerCase();
          if ((name.includes('score') && name.includes('exact')) || (name.includes('score') && name.includes('correct'))) {
            if (name.includes('mi-tps') || name.includes('2') || name.includes('ht') || name.includes('half')) continue;
            
            const items = [...(bt.eventBetTypeItems || [])].sort((a, b) => parseFloat(a.odds) - parseFloat(b.odds));
            if (items.length > 0) {
              const best = items[0];
              const sn = best.shortName || '';
              const cleaned = sn.replace(/\s/g, '').replace('-', ':');
              const parts = cleaned.split(':');
              scoreExactPrediction = {
                score: sn,
                home: parseInt(parts[0]) || 0,
                away: parseInt(parts[1]) || 0,
                odds: best.odds,
              };
            }
            break;
          }
        }
        
        const predictionStr = scoreExactPrediction 
          ? `→ ${scoreExactPrediction.home}-${scoreExactPrediction.away} (odds: ${scoreExactPrediction.odds})`
          : '→ no prediction found';
        
        log(`  ${m.homeTeam?.name} vs ${m.awayTeam?.name} id=${m.id} ${predictionStr}`);
        
        // Also check entryPointId and other fields
        const extras = Object.keys(m).filter(k => !['homeTeam', 'awayTeam', 'eventBetTypes', 'id'].includes(k));
        if (extras.length > 0) {
          log(`    Extra fields: ${extras.join(', ')}`);
        }
      }
    }
  }
  
  // Phase 4: Cross-league playout scan
  log('\n--- PHASE 4: CROSS-LEAGUE PLOUT SCAN ---\n');
  
  // Test if playout from one league's eventCategoryId works for another
  for (const ar of activeRounds.filter(r => r.hasBetting && r.eventCategoryId)) {
    // Test playout WITHOUT eventCategoryId (just parentEventCategoryId)
    const url1 = `${B}/round/${ar.round}/playout?parentEventCategoryId=${ar.leagueId}`;
    const r1 = await fetchJSON(url1);
    const j1 = parseJson(r1.body);
    log(`  ${ar.leagueId} round ${ar.round} NO catId: HTTP ${r1.status} (${j1?.matches?.length || 0} matches)`);
    
    // Test with a DIFFERENT league's eventCategoryId
    const otherRound = activeRounds.find(r => r.leagueId !== ar.leagueId && r.eventCategoryId);
    if (otherRound) {
      const url2 = `${B}/round/${ar.round}/playout?parentEventCategoryId=${ar.leagueId}&eventCategoryId=${otherRound.eventCategoryId}`;
      const r2 = await fetchJSON(url2);
      const j2 = parseJson(r2.body);
      log(`  ${ar.leagueId} round ${ar.round} WRONG catId (${otherRound.leagueId}'s): HTTP ${r2.status} (${j2?.matches?.length || 0} matches)`);
    }
  }
  
  // Phase 5: Check if results endpoint has anything for current rounds
  log('\n--- PHASE 5: RESULTS ENDPOINT CHECK ---\n');
  
  for (const leagueId of LEAGUES.slice(0, 3)) {
    const r = await fetchJSON(`${B}/${leagueId}/results?skip=0&take=200`);
    if (r.status !== 200) continue;
    const j = parseJson(r.body);
    const rounds = j?.rounds || [];
    log(`  ${leagueId} /results: ${rounds.length} rounds`);
    for (const rd of rounds.slice(0, 3)) {
      const matches = rd.matches || [];
      const lastMatch = matches[matches.length - 1];
      const score = lastMatch?.score || 'none';
      log(`    Round ${rd.roundNumber}: ${matches.length} matches, last score: ${score}`);
    }
  }
  
  log('\n=== ANALYSIS COMPLETE ===');
  fs.writeFileSync('/home/z/my-project/download/timing-analysis.txt', output, 'utf-8');
  log('Saved: /home/z/my-project/download/timing-analysis.txt');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  fs.writeFileSync('/home/z/my-project/download/timing-analysis.txt', output, 'utf-8');
});
