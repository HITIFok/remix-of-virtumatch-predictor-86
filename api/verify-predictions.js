// Vercel Serverless Function — verify-predictions v20 (ESM)
// Converted from Supabase Edge Function (Deno) to Vercel (Node.js)
// Verifies pending predictions using MATCH ID (no confusion)
//
// v20: Match-ID-first verification
//   1. Fetch /matches for each league → build set of ACTIVE match IDs
//   2. If prediction.match_id NOT in active set → match is finished
//   3. Fetch /results for that league → find by round + team names

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

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  for (let i = 0; i < aBytes.length; i++) {
    if (aBytes[i] !== bBytes[i]) return false;
  }
  return true;
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

// Fetch results from /results endpoint (on demand per league)
async function fetchLeagueResults(leagueId) {
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
    console.log(`[verify] /results ${leagueId} error: ${err.message}`);
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
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type, Authorization, x-cron-key');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  const startTime = Date.now();
  console.log('=== verify-predictions v20 (match-id-first) ===');

  try {
    if (!NEON_DATABASE_URL) {
      return res.status(500).json({ error: 'NEON_DATABASE_URL not configured' });
    }

    const sql = postgres(NEON_DATABASE_URL);

    // Mode detection: CRON vs CLIENT
    const cronKey = req.headers['x-cron-key'];
    const expectedCronKey = process.env.CRON_SECRET;
    const isCron = cronKey && expectedCronKey && timingSafeEqual(cronKey, expectedCronKey);

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
      console.log(`[verify] Mode: CLIENT (device: ${deviceId || 'all'})`);
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

    // 3. Separate predictions: those with match_id vs without
    const withId = pendingPredictions.filter(p => p.match_id && p.match_id > 0);
    const withoutId = pendingPredictions.filter(p => !p.match_id || p.match_id <= 0);
    console.log(`[verify] with match_id: ${withId.length}, without: ${withoutId.length}`);

    // 4. Verify predictions
    let correct = 0, incorrect = 0, stillActive = 0, notFound = 0;
    const updates = [];
    const resultsCache = new Map();

    async function getResultsForLeague(leagueId) {
      let cached = resultsCache.get(leagueId);
      if (cached) return cached;
      cached = await fetchLeagueResults(leagueId);
      resultsCache.set(leagueId, cached);
      return cached;
    }

    // 4a. Verify predictions WITH match_id
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
        const roundResults = await getResultsForLeague(leagueId);

        if (predRound > 0) {
          const roundMatches = roundResults.get(predRound);
          if (!roundMatches) continue;
          const match = findInRound(predHome, predAway, roundMatches);
          if (match) {
            const isCorrect = pred.prediction === match.outcome;
            const status = isCorrect ? 'correct' : 'incorrect';
            if (isCorrect) correct++; else incorrect++;
            updates.push(patchPrediction(sql, pred.id, match, status));
            console.log(`${isCorrect ? 'OK' : 'NO'} [match_id=${predMatchId}] ${pred.home_team} vs ${pred.away_team}: pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
            found = true; break;
          }
        } else {
          for (const [roundNum, roundMatches] of roundResults) {
            const match = findInRound(predHome, predAway, roundMatches);
            if (match) {
              const isCorrect = pred.prediction === match.outcome;
              const status = isCorrect ? 'correct' : 'incorrect';
              if (isCorrect) correct++; else incorrect++;
              updates.push(patchPrediction(sql, pred.id, match, status));
              console.log(`${isCorrect ? 'OK' : 'NO'} [match_id=${predMatchId}] ${pred.home_team} vs ${pred.away_team} (round=${roundNum}): pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
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

    // 4b. Verify predictions WITHOUT match_id
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
        const roundResults = await getResultsForLeague(leagueId);
        const roundsToSearch = predRound > 0
          ? [[predRound, roundResults.get(predRound)]]
          : [...roundResults.entries()];

        for (const [roundNum, roundMatches] of roundsToSearch) {
          if (!roundMatches) continue;
          const match = findInRound(predHome, predAway, roundMatches);
          if (match) {
            const isCorrect = pred.prediction === match.outcome;
            const status = isCorrect ? 'correct' : 'incorrect';
            if (isCorrect) correct++; else incorrect++;
            updates.push(patchPrediction(sql, pred.id, match, status));
            console.log(`${isCorrect ? 'OK' : 'NO'} [no_id] ${pred.home_team} vs ${pred.away_team} (round=${roundNum}): pred=${pred.prediction} actual=${match.outcome} (${match.score})`);
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
    console.log(`[verify] Done: ${correct} OK, ${incorrect} NO, ${stillActive} still_active, ${notFound} miss, ${failedUpdates} failed (${elapsed}ms)`);

    return res.status(200).json({
      success: true,
      mode: callerMode,
      version: 'v20-match-id',
      withMatchId: withId.length,
      withoutMatchId: withoutId.length,
      correct, incorrect,
      stillActive,
      notFound,
      failedUpdates,
      verified: updates.length,
      stillPending: pendingPredictions.length - updates.length,
      elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[verify] Error (${elapsed}ms):`, error);
    return res.status(500).json({ error: error.message, elapsed });
  }
}
