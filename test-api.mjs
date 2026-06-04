#!/usr/bin/env node
/**
 * Sporty Instant Leagues API Explorer - Fast version with parallel fetches
 */
import fs from 'fs';
import https from 'https';
import http from 'http';
import { URL } from 'url';

const OUTPUT_FILE = '/home/z/my-project/download/api-exploration.txt';
let output = '';

function log(msg) {
  console.log(msg);
  output += msg + '\n';
}

function sep(c = '=', n = 80) { output += c.repeat(n) + '\n'; }

function fetchJSON(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(url, {
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-language': 'fr',
          'app-version': '33470',
          'referer': 'https://bet261.mg/',
          'origin': 'https://bet261.mg/',
          'sec-ch-ua': '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
        },
        timeout: timeoutMs,
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, ct: res.headers['content-type'] || '', body }));
      });
      req.on('error', () => resolve({ status: 0, ct: '', body: '', error: true }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, ct: '', body: '', error: true }); });
    } catch(e) { resolve({ status: 0, ct: '', body: '', error: true }); }
  });
}

async function test(url, label, full = false) {
  const r = await fetchJSON(url);
  log(`\n[${label}] status=${r.status} ct=${r.ct.substring(0,30)} len=${r.body.length}${r.error?' ERROR':''}`);
  log(`BODY: ${r.body.substring(0, full ? 6000 : 400)}`);
  
  if (r.status === 200 && r.ct.includes('json')) {
    try {
      const j = JSON.parse(r.body);
      // Score field search
      const sf = searchFields(j, ['score','result','predetermined','pred','simulated','virtual','finalscore','matchresult','finalresult','goals','goal','homescore','awayscore','winner','status','state','phase','minute']);
      if (sf.length > 0) {
        log(`SCORE FIELDS:`);
        sf.slice(0, 10).forEach(f => log(`  ${f.p} = ${JSON.stringify(f.v).substring(0,120)}`));
      }
    } catch(e) {}
  }
  return r;
}

function searchFields(obj, kws, prefix = '', res = []) {
  if (res.length > 30 || typeof obj !== 'object' || obj === null) return res;
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 5); i++) searchFields(obj[i], kws, `${prefix}[${i}]`, res);
  } else {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (kws.some(w => k.toLowerCase().includes(w))) res.push({ p, v });
      if (typeof v === 'object' && v !== null) searchFields(v, kws, p, res);
    }
  }
  return res;
}

async function main() {
  log('SPORTY INSTANT LEAGUES API EXPLORATION');
  log(`Time: ${new Date().toISOString()}`);
  sep('#');

  const B = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues';
  
  // ===== SECTION 1: Main endpoints (batch parallel in groups of 5) =====
  log('\n===== SECTION 1: STANDARD ENDPOINTS =====');
  const eps1 = [
    '/8035/matches', '/8035/ranking', '/8035/results?skip=0&take=200',
    '/8035/schedule', '/8035/live', '/8035/fixtures', '/8035/events',
    '/8035/scores', '/8035/rounds', '/8035/rounds/current',
  ];
  for (const ep of eps1) await test(B + ep, ep);
  
  const eps2 = [
    '/8035/round/1/playout?parentEventCategoryId=8035',
    '/8035/round/2/playout?parentEventCategoryId=8035',
    '/8035/round/3/playout?parentEventCategoryId=8035',
    '/8035/round/2/schedule?parentEventCategoryId=8035',
    '/8035/round/2/results?parentEventCategoryId=8035',
    '/8035/round/2/live?parentEventCategoryId=8035',
    '/8035/round/2/matches?parentEventCategoryId=8035',
    '/8035/round/2/scores?parentEventCategoryId=8035',
    '/8035/playout?parentEventCategoryId=8035',
    '/8035/prematch?parentEventCategoryId=8035',
  ];
  for (const ep of eps2) await test(B + ep, ep, true);

  const eps3 = [
    '/8035/highlights?parentEventCategoryId=8035',
    '/8035/incidents?parentEventCategoryId=8035',
    '/8035/statistics?parentEventCategoryId=8035',
    '/8035/odds', '/8035/markets', '/8035/bettypes',
    '/8035/standings', '/8035/table',
    '/8035/live/standings', '/8035/live/table',
    '/8035/live/matches', '/8035/live/scores', '/8035/live/events',
    '/8035/live/playout?parentEventCategoryId=8035',
  ];
  for (const ep of eps3) await test(B + ep, ep);

  // ===== SECTION 2: Alt URL patterns =====
  log('\n===== SECTION 2: ALT URL PATTERNS =====');
  for (const a of [
    [`${B}/parentEventCategoryId/8035/matches`, 'parentECId/matches'],
    [`${B}/parentEventCategoryId/8035/playout`, 'parentECId/playout'],
    [`${B}/parentEventCategoryId/8035/round/2/playout`, 'parentECId/round/2/playout'],
    [`${B}/league/8035/matches`, 'league/matches'],
    [`${B}/league/8035/playout`, 'league/playout'],
    [`${B}/eventCategory/8035/matches`, 'eventCategory/matches'],
    [`${B}/eventCategory/8035/playout`, 'eventCategory/playout'],
    [`${B}/8035/round/2/playout`, 'round/2/playout (no param)'],
  ]) await test(a[0], a[1]);

  // ===== SECTION 3: Alt bases =====
  log('\n===== SECTION 3: ALT BASE URLS =====');
  await test('https://hg-event-api-prod.sporty-tech.net/api/v1/instantleagues/8035/matches', 'v1');
  await test('https://hg-event-api-prod.sporty-tech.net/api/v2/instantleagues/8035/matches', 'v2');

  // ===== SECTION 4: Full /matches dump + deep analysis =====
  log('\n===== SECTION 4: DEEP /matches ANALYSIS =====');
  const mr = await fetchJSON(B + '/8035/matches');
  if (mr.status === 200) {
    const j = JSON.parse(mr.body);
    log('FULL JSON:');
    log(JSON.stringify(j, null, 2));
    
    // Find all match-like objects and log every field
    const matches = [];
    (function find(m, d = 0) {
      if (d > 6 || typeof m !== 'object' || m === null) return;
      if (Array.isArray(m)) { m.forEach(x => find(x, d+1)); return; }
      const k = Object.keys(m);
      if ((k.some(x => /home/i.test(x)) && k.some(x => /away/i.test(x))) || k.includes('participants')) matches.push(m);
      Object.values(m).forEach(v => { if (typeof v === 'object') find(v, d+1); });
    })(j);
    
    log(`\nFound ${matches.length} match objects:`);
    matches.forEach((m, i) => {
      log(`\n=== MATCH ${i+1} keys: ${Object.keys(m).join(', ')} ===`);
      Object.entries(m).forEach(([k, v]) => {
        log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v).substring(0,500) : JSON.stringify(v)}`);
      });
    });
  }

  // ===== SECTION 5: Playout sweep 1-10 =====
  log('\n===== SECTION 5: PLAYOUT ROUNDS 1-10 =====');
  for (let r = 1; r <= 10; r++) {
    const res = await fetchJSON(`${B}/8035/round/${r}/playout?parentEventCategoryId=8035`);
    const ok = res.status === 200 && res.body.length > 5;
    log(`Round ${r}: ${res.status} len=${res.body.length} data=${ok}`);
    if (ok) log(`  ${res.body.substring(0, 4000)}`);
  }

  // ===== SECTION 6: bet261.mg =====
  log('\n===== SECTION 6: bet261.mg PROXY =====');
  await test('https://bet261.mg/api/instantleagues/8035/matches', 'bet261 matches', true);
  await test('https://bet261.mg/api/instantleagues/8035/round/2/playout?parentEventCategoryId=8035', 'bet261 playout', true);

  // ===== SECTION 7: Creative endpoints =====
  log('\n===== SECTION 7: CREATIVE ENDPOINTS =====');
  for (const ep of [
    '/8035/round/1/scores', '/8035/round/1/results', '/8035/round/1/events',
    '/8035/round/1/matches', '/8035/round/2/scores', '/8035/round/2/events',
    '/8035/topscorers', '/8035/players', '/8035/teams', '/8035/season',
    '/8035/info', '/8035/config', '/8035/metadata', '/8035/liveodds',
    '/8035/lineup', '/8035/lineups', '/8035/commentary',
    '/8035/matches?parentEventCategoryId=8035',
    '/8035/playout?round=2&parentEventCategoryId=8035',
    '/8035/ranking?parentEventCategoryId=8035',
  ]) await test(B + ep, ep);

  // ===== SECTION 8: WebSocket (simple, quick) =====
  log('\n===== SECTION 8: WEBSOCKET TESTS =====');
  try {
    const WebSocket = (await import('ws')).default;
    for (const wsUrl of [
      'wss://hg-event-api-prod.sporty-tech.net/ws/instantleagues',
      'wss://hg-event-api-prod.sporty-tech.net/api/instantleagues/ws',
      'wss://hg-event-api-prod.sporty-tech.net/ws',
    ]) {
      log(`WS: ${wsUrl}`);
      await new Promise(res => {
        let done = false;
        const t = setTimeout(() => { if (!done) { done=true; log('  TIMEOUT'); res(); } }, 3000);
        try {
          const ws = new WebSocket(wsUrl, { headers: { origin: 'https://bet261.mg/', 'user-agent': 'Mozilla/5.0', 'app-version': '33470' }, rejectUnauthorized: false });
          ws.on('open', () => { log('  OPEN'); setTimeout(()=>{ws.close();res();},1000); });
          ws.on('message', d => log(`  MSG: ${d.toString().substring(0,200)}`));
          ws.on('error', e => { if(!done){done=true;clearTimeout(t);log(`  ERR: ${e.message}`);res();}});
          ws.on('close', c => { if(!done){done=true;clearTimeout(t);log(`  CLOSE:${c}`);res();}});
        } catch(e) { if(!done){done=true;clearTimeout(t);log(`  EXC: ${e.message}`);res();}}
      });
    }
  } catch(e) { log(`WS skip: ${e.message}`); }

  // Done
  log(`\n===== COMPLETE =====`);
  fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');
  log(`Saved: ${OUTPUT_FILE} (${(output.length/1024).toFixed(1)}KB)`);
}

main().catch(e => { log(`FATAL: ${e.message}`); fs.writeFileSync(OUTPUT_FILE, output, 'utf-8'); });
