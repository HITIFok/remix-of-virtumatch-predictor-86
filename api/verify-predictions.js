// Vercel Serverless Function — verify-predictions v21 (ESM)
// Converted from Supabase Edge Function (Deno) to Vercel (Node.js)
// Verifies pending predictions using MATCH ID (no confusion)
//
// v21: DB-first verification (auto-playout integration)
//   1. Fetch /matches for each league → build set of ACTIVE match IDs
//   2. If prediction.match_id NOT in active set → match is finished
//   3. Check match_results table FIRST (instant, no API calls)
//   4. Fallback: fetch /results API for that league → find by round + team names

import crypto from 'crypto';
import postgres from 'postgres';
import { setCorsHeaders } from './_lib/cors.js';

const API_BASE = 'https://hg-event-api-prod.sporty-tech.net/api/instantleagues';
const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

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

const HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'fr',
  'app-version': '33470',
  'referer': 'https://bet261.mg/',
  'sec-ch-ua': '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
};

// Timing-safe comparison using Node.js crypto module (same pattern as admin-verify.js)
function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const aBuf = Buffer.from(encoder.encode(a));
  const bBuf = Buffer.from(encoder.encode(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function norm(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function findInRound(predHome, predAway, roundMatches) {
  // 1. Exact
  for (const m of roundMatches) {
    if (m.home.toLowerCase() === predHome && m.away.toLowerCase() === predAway) return m;
  }
  // 2. Normalized (strip accents)
  const pH = norm(predHome), pA = norm(predAway);
  for (const m of roundMatches) {
    if (norm(m.home) === pH && norm(m.away) === pA) return m;
  }
  // 3. Contains (partial)
  for (const m of roundMatches) {
    const mH = m.home.toLowerCase(), mA = m.away.toLowerCase();
    if ((mH.includes(predHome) || predHome.includes(mH)) &&
        (mA.includes(predAway) || predAway.includes(mA))) return m;
  }
  return null;
}

// Fetch active match IDs from /matches endpoint
async function fetchActiveMatchIds() {
  const activeByLeague = new Map();
  const results = await Promise.all(LEAGUES.map(async (l) => {
    try {
      const res = await fetch(`${API_BASE}/${l.id}/matches`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { leagueId: l.id, ids: [] };
      const data = await res.json();
      const ids = [];
      if (data?.rounds) {
        for (const rd of data.rounds) {
          for (const m of rd.matches || []) {
            if (m.id && m.id > 0) ids.push(m.id);
          }
        }
      }
      return { leagueId: l.id, ids };
    } catch (err) {
      console.log(`[verify] /matches ${l.id} error: ${err.message}`);
      return { leagueId: l.id, ids: [] };
    }
  }));

  for (const { leagueId, ids } of results) {
    activeByLeague.set(leagueId, new Set(ids));
  }
  const totalActive = results.reduce((s, r) => s + r.ids.length, 0);
  console.log(`[verify] Active matches: ${totalActive} across ${activeByLeague.size} leagues`);
  return activeByLeague;
}

// v21: Fetch results from match_results table (instant, no API)
async function fetchDbResults(sql, leagueId) {
  const roundResults = new Map();
  try {
    const rows = await sql`
      SELECT round_number, match_id, home_team, away_team, score_home, score_away, outcome
      FROM match_results
      WHERE league_id = ${leagueId}
      ORDER BY round_number ASC
    `;
    for (const row of rows) {
      const roundNum = row.round_number;
      if (!roundResults.has(roundNum)) roundResults.set(roundNum, []);
      roundResults.get(roundNum).push({
        home: row.home_team,
        away: row.away_team,
        score: `${row.score_home}:${row.score_away}`,
        homeScore: row.score_home,
        awayScore: row.score_away,
        outcome: row.outcome,
        matchId: row.match_id,
      });
    }
    if (roundResults.size > 0) {
      console.log(`[verify] DB results for ${leagueId}: ${roundResults.size} rounds`);
    }
  } catch (err) {
    // Table may not exist yet (first deploy before auto-playout runs)
    console.log(`[verify] DB results ${leagueId} error: ${err.message}`);
  }
  return roundResults;
}

// Fetch results from /results endpoint (fallback, on demand per league)
async function fetchApiResults(leagueId) {
  const roundResults = new Map();
  try {
    const res = await fetch(`${API_BASE}/${leagueId}/results?skip=0&take=200`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return roundResults;
    const data = await res.json();
    if (data?.rounds) {
      for (const rd of data.rounds) {
        const roundNum = rd.roundNumber || 0;
        if (roundNum <= 0) continue;
        const matches = [];
        for (const m of rd.matches || []) {
          const home = m.homeTeam?.name || '';
          const away = m.awayTeam?.name || '';
          if (!home || !away) continue;
          const score = m.score || '0:0';
          const parts = score.split(':');
          const h = parseInt(parts[0]) || 0;
          const a = parseInt(parts[1]) || 0;
          matches.push({
            home, away, score, homeScore: h, awayScore: a,
            outcome: h > a ? '1' : h < a ? '2' : 'X',
          });
        }
        if (matches.length > 0) roundResults.set(roundNum, matches);
      }
    }
  } catch (err) {
    console.log(`[verify] /results API ${leagueId} error: ${err.message}`);
  }
  return roundResults;
}

function patchPrediction(sql, id, match, status) {
  return sql`
    UPDATE predictions SET
      actual_home_score = ${match.homeScore},
      actual_away_score = ${match.awayScore},
      actual_outcome = ${match.outcome},
      actual_score = ${match.score},
      status = ${status},
      verified_at = NOW()
    WHERE id = ${id}
  `;
}

export default async function handler(req, res) {
  // CORS (uses shared module — no wildcard)
  setCorsHeaders(req, res, 'GET, POST, OPTIONS', 'Content-Type, Authorization, x-cron-key');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  const startTime = Date.now();
  console.log('=== verify-predictions v21 (db-first) ===');

  try {
    if (!NEON_DATABASE_URL) {
      return res.status(500).json({ error: 'NEON_DATABASE_URL not configured' });
    }

    const sql = postgres(NEON_DATABASE_URL);

    // Mode detection: CRON vs CLIENT
    // CRON = valid x-cron-key header (works with GET or POST)
    // CLIENT = POST with device_id in body
    const cronKey = req.headers['x-cron-key'] || '';
    const expectedCronKey = process.env.CRON_SECRET || '';
    const isCron = !!(cronKey && expectedCronKey && timingSafeEqual(cronKey, expectedCronKey));

    let deviceId;
    let callerMode;

    if (isCron) {
      callerMode = 'cron';
      console.log('[verify] Mode: CRON (full scan)');
    } else {
      callerMode = 'client';
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        deviceId = body?.deviceId || body?.device_id;
      } catch { /* no body */ }

      // Sécurité C3 : en mode client, un device_id est OBLIGATOIRE
      // Sinon n'importe qui peut déclencher un scan complet de la DB + 9 appels API externes
      if (!deviceId) {
        return res.status(400).json({
          success: false,
          error: 'device_id requis en mode client',
        });
      }

      // Valider le format du device_id
      if (!/^dev-\d+-[a-z0-9]+$/i.test(deviceId)) {
        return res.status(400).json({
          success: false,
          error: 'Format device_id invalide',
        });
      }

      console.log(`[verify] Mode: CLIENT (device: ${deviceId})`);
    }

    // 1. Fetch pending predictions from Neon
    let pendingPredictions;
    if (deviceId) {
      pendingPredictions = await sql`
        SELECT * FROM predictions
        WHERE status = 'pending' AND device_id = ${deviceId}
        ORDER BY created_at ASC LIMIT 200
      `;
    } else {
      pendingPredictions = await sql`
        SELECT * FROM predictions
        WHERE status = 'pending'
        ORDER BY created_at ASC LIMIT 200
      `;
    }
    console.log(`[verify] ${pendingPredictions.length} pending predictions`);

    if (pendingPredictions.length === 0) {
      await sql.end();
      return res.status(200).json({
        success: true, message: 'Aucune prédiction en attente',
        verified: 0, elapsed: Date.now() - startTime,
      });
    }

    // 2. Fetch ALL active match IDs from /matches (parallel, all leagues)
    const activeByLeague = await fetchActiveMatchIds();

    // 2b. v21: Pre-load match_results from DB for ALL leagues (instant, 1 query)
    const dbResultsCache = new Map();
    try {
      const allDbRows = await sql`
        SELECT league_id, round_number, match_id, home_team, away_team, score_home, score_away, outcome
        FROM match_results
      `;
      for (const row of allDbRows) {
        const lid = row.league_id;
        if (!dbResultsCache.has(lid)) dbResultsCache.set(lid, new Map());
        const leagueMap = dbResultsCache.get(lid);
        if (!leagueMap.has(row.round_number)) leagueMap.set(row.round_number, []);
        leagueMap.get(row.round_number).push({
          home: row.home_team,
          away: row.away_team,
          score: `${row.score_home}:${row.score_away}`,
          homeScore: row.score_home,
          awayScore: row.score_away,
          outcome: row.outcome,
          matchId: row.match_id,
        });
      }
      const totalDbRounds = [...dbResultsCache.values()].reduce((s, m) => s + m.size, 0);
      console.log(`[verify] DB cache: ${allDbRows.length} results across ${dbResultsCache.size} leagues, ${totalDbRounds} rounds`);
    } catch (err) {
      console.log(`[verify] DB cache error (table may not exist): ${err.message}`);
    }

    // 3. Separate predictions: those with match_id vs without
    const withId = pendingPredictions.filter(p => p.match_id && p.match_id > 0);
    const withoutId = pendingPredictions.filter(p => !p.match_id || p.match_id <= 0);
    console.log(`[verify] with match_id: ${withId.length}, without: ${withoutId.length}`);

    // 4. Verify predictions
    let correct = 0, incorrect = 0, stillActive = 0, notFound = 0;
    let dbHits = 0, apiHits = 0;
    const updates = [];
    const apiResultsCache = new Map();

    // v21: DB-first results lookup (checks match_results table, falls back to API)
    function getResultsForLeague(leagueId) {
      // Priority 1: DB cache (instant)
      const dbLeague = dbResultsCache.get(leagueId);
      if (dbLeague && dbLeague.size > 0) {
        // Merge all rounds into a single Map
        const merged = new Map();
        for (const [roundNum, matches] of dbLeague) {
          merged.set(roundNum, matches);
        }
        return { results: merged, source: 'db' };
      }
      return { results: new Map(), source: 'none' };
    }

    async function getApiResultsForLeague(leagueId) {
      let cached = apiResultsCache.get(leagueId);
      if (cached) return cached;
      cached = await fetchApiResults(leagueId);
      apiResultsCache.set(leagueId, cached);
      return cached;
    }

    // 4a. Verify predictions WITH match_id (DB-first, API fallback)
    for (const pred of withId) {
      const predLeagueId = String(pred.league_id || '');
      const predRound = pred.round || 0;
      const predMatchId = Number(pred.match_id);

      let isActive = false;
      if (predLeagueId) {
        const activeIds = activeByLeague.get(predLeagueId);
        if (activeIds?.has(predMatchId)) isActive = true;
      }
      if (!isActive) {
        for (const [, ids] of activeByLeague) {
          if (ids.has(predMatchId)) { isActive = true; break; }
        }
      }

      if (isActive) {
        stillActive++;
        continue;
      }

      const predHome = (pred.home_team || '').trim().toLowerCase();
      const predAway = (pred.away_team || '').trim().toLowerCase();
      if (!predHome || !predAway) { notFound++; continue; }

      const leaguesToCheck = predLeagueId
        ? [predLeagueId, ...LEAGUES.map(l => l.id).filter(id => id !== predLeagueId)]
        : LEAGUES.map(l => l.id);

      let found = false;
      for (const leagueId of leaguesToCheck) {
        // v21: Try DB first
        const { results: dbRoundResults, source } = getResultsForLeague(leagueId);

        if (source === 'db') {
          if (predRound > 0) {
            const roundMatches = dbRoundResults.get(predRound);
            if (roundMatches) {
              const match = findInRound(predHome, predAway, roundMatches);
              if (match) {
                const isCorrect = pred.prediction === match.outcome;
                const status = isCorrect ? 'correct' : 'incorrect';
                if (isCorrect) correct++; else incorrect++;
                dbHits++;
                updates.push(patchPrediction(sql, pred.id, match, status));
                console.log(`${isCorrect ? 'OK' : 'NO'} [DB] [match_id=${predMatchId}] ${pred.home_team} vs ${pred.away_team}: pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
                found = true; break;
              }
            }
          } else {
            for (const [roundNum, roundMatches] of dbRoundResults) {
              const match = findInRound(predHome, predAway, roundMatches);
              if (match) {
                const isCorrect = pred.prediction === match.outcome;
                const status = isCorrect ? 'correct' : 'incorrect';
                if (isCorrect) correct++; else incorrect++;
                dbHits++;
                updates.push(patchPrediction(sql, pred.id, match, status));
                console.log(`${isCorrect ? 'OK' : 'NO'} [DB] [match_id=${predMatchId}] ${pred.home_team} vs ${pred.away_team} (round=${roundNum}): pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
                found = true; break;
              }
            }
            if (found) break;
          }
        }

        if (found) break;

        // Fallback: API results
        const apiRoundResults = await getApiResultsForLeague(leagueId);
        if (predRound > 0) {
          const roundMatches = apiRoundResults.get(predRound);
          if (!roundMatches) continue;
          const match = findInRound(predHome, predAway, roundMatches);
          if (match) {
            const isCorrect = pred.prediction === match.outcome;
            const status = isCorrect ? 'correct' : 'incorrect';
            if (isCorrect) correct++; else incorrect++;
            apiHits++;
            updates.push(patchPrediction(sql, pred.id, match, status));
            console.log(`${isCorrect ? 'OK' : 'NO'} [API] [match_id=${predMatchId}] ${pred.home_team} vs ${pred.away_team}: pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
            found = true; break;
          }
        } else {
          for (const [roundNum, roundMatches] of apiRoundResults) {
            const match = findInRound(predHome, predAway, roundMatches);
            if (match) {
              const isCorrect = pred.prediction === match.outcome;
              const status = isCorrect ? 'correct' : 'incorrect';
              if (isCorrect) correct++; else incorrect++;
              apiHits++;
              updates.push(patchPrediction(sql, pred.id, match, status));
              console.log(`${isCorrect ? 'OK' : 'NO'} [API] [match_id=${predMatchId}] ${pred.home_team} vs ${pred.away_team} (round=${roundNum}): pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
              found = true; break;
            }
          }
          if (found) break;
        }
      }

      if (!found) {
        notFound++;
        console.log(`[verify] MISS: ${pred.home_team} vs ${pred.away_team} | id=${predMatchId} | league=${predLeagueId || '?'} | round=${predRound || '?'}`);
      }
    }

    // 4b. Verify predictions WITHOUT match_id (DB-first, API fallback)
    for (const pred of withoutId) {
      const predLeagueId = String(pred.league_id || '');
      const predRound = pred.round || 0;
      const predHome = (pred.home_team || '').trim().toLowerCase();
      const predAway = (pred.away_team || '').trim().toLowerCase();
      if (!predHome || !predAway) { notFound++; continue; }

      const leaguesToCheck = predLeagueId
        ? [predLeagueId, ...LEAGUES.map(l => l.id).filter(id => id !== predLeagueId)]
        : LEAGUES.map(l => l.id);

      let found = false;
      for (const leagueId of leaguesToCheck) {
        // v21: Try DB first
        const { results: dbRoundResults, source } = getResultsForLeague(leagueId);

        if (source === 'db') {
          const roundsToSearch = predRound > 0
            ? [[predRound, dbRoundResults.get(predRound)]]
            : [...dbRoundResults.entries()];

          for (const [roundNum, roundMatches] of roundsToSearch) {
            if (!roundMatches) continue;
            const match = findInRound(predHome, predAway, roundMatches);
            if (match) {
              const isCorrect = pred.prediction === match.outcome;
              const status = isCorrect ? 'correct' : 'incorrect';
              if (isCorrect) correct++; else incorrect++;
              dbHits++;
              updates.push(patchPrediction(sql, pred.id, match, status));
              console.log(`${isCorrect ? 'OK' : 'NO'} [DB] [no_id] ${pred.home_team} vs ${pred.away_team} (round=${roundNum}): pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
              found = true; break;
            }
          }
        }

        if (found) break;

        // Fallback: API results
        const apiRoundResults = await getApiResultsForLeague(leagueId);
        const roundsToSearch = predRound > 0
          ? [[predRound, apiRoundResults.get(predRound)]]
          : [...apiRoundResults.entries()];

        for (const [roundNum, roundMatches] of roundsToSearch) {
          if (!roundMatches) continue;
          const match = findInRound(predHome, predAway, roundMatches);
          if (match) {
            const isCorrect = pred.prediction === match.outcome;
            const status = isCorrect ? 'correct' : 'incorrect';
            if (isCorrect) correct++; else incorrect++;
            apiHits++;
            updates.push(patchPrediction(sql, pred.id, match, status));
            console.log(`${isCorrect ? 'OK' : 'NO'} [API] [no_id] ${pred.home_team} vs ${pred.away_team} (round=${roundNum}): pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
            found = true; break;
          }
        }
        if (found) break;
      }

      if (!found) {
        notFound++;
        console.log(`[verify] MISS: ${pred.home_team} vs ${pred.away_team} | no match_id | league=${predLeagueId || '?'} | round=${predRound || '?'}`);
      }
    }

    // 5. Execute all updates
    const settled = await Promise.allSettled(updates);
    const failedUpdates = settled.filter(r => r.status === 'rejected').length;

    await sql.end();

    const elapsed = Date.now() - startTime;
    console.log(`[verify] Done: ${correct} OK, ${incorrect} NO, ${stillActive} still_active, ${notFound} miss, ${failedUpdates} failed (${elapsed}ms) [DB=${dbHits}, API=${apiHits}]`);

    return res.status(200).json({
      success: true,
      mode: callerMode,
      version: 'v21-db-first',
      withMatchId: withId.length,
      withoutMatchId: withoutId.length,
      correct, incorrect,
      stillActive,
      notFound,
      failedUpdates,
      verified: updates.length,
      stillPending: pendingPredictions.length - updates.length,
      dbHits, apiHits,
      elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[verify] Error (${elapsed}ms):`, error);
    return res.status(500).json({ error: error.message, elapsed });
  }
}
