// Vercel Serverless Function — auto-playout v1 (ESM)
// Cron job: fetches playout results at expectedStart + 100s for each round
//
// Strategy:
//   1. Fetch /matches for ALL leagues → discover rounds + their expectedStart timestamps
//   2. Compare expectedStart with now → find rounds that started 60-180s ago
//   3. For qualifying rounds → fetch /playout → store results in match_results table
//   4. Also triggers verify-predictions after storing results
//
// Vercel Cron: runs every minute via vercel.json crons config

import crypto from 'crypto';
import { createSql } from './_lib/db.js';

// ─── Configuration ─────────────────────────────────────────────────────

const SPORTY_API_BASE = process.env.SPORTY_API_BASE || '';

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
  'Origin': process.env.API_ORIGIN || '',
  'Referer': process.env.API_REFERER || '',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'App-Version': process.env.API_APP_VERSION || '',
};

const CONF_BEARER = process.env.SPORTY_BEARER || '';
const API_HEADERS = CONF_BEARER
  ? { ...HEADERS, 'Authorization': `Bearer ${CONF_BEARER}` }
  : HEADERS;

// Timing-safe comparison (same pattern as admin-verify.js, verify-predictions.js)
function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const aBuf = Buffer.from(encoder.encode(a));
  const bBuf = Buffer.from(encoder.encode(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// ─── API helpers ─────────────────────────────────────────────────────────

async function fetchAPI(path, timeoutMs = 6000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${SPORTY_API_BASE}${path}`, {
      headers: API_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.log(`[auto-playout] API ${res.status} for ${path}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`[auto-playout] fetchAPI error for ${path}: ${e.message}`);
    return null;
  }
}

// ─── Core logic ──────────────────────────────────────────────────────────

/**
 * Fetch matches for a league, extract rounds with their expectedStart
 * and eventCategoryId, plus match details (team names, IDs).
 */
async function discoverRounds(leagueId) {
  const data = await fetchAPI(`/${leagueId}/matches`, 6000);
  if (!data?.rounds) return [];

  const rounds = [];
  for (const rd of data.rounds) {
    const roundNum = rd.roundNumber || 0;
    if (roundNum <= 0) continue;

    const matches = [];
    for (const m of rd.matches || []) {
      matches.push({
        id: m.id,
        homeTeam: m.homeTeam?.name || '',
        awayTeam: m.awayTeam?.name || '',
      });
    }

    rounds.push({
      leagueId,
      leagueName: LEAGUES.find(l => l.id === leagueId)?.name || 'Unknown',
      roundNumber: roundNum,
      eventCategoryId: rd.eventCategoryId || null,
      expectedStart: rd.expectedStart || null,
      matches,
    });
  }
  return rounds;
}

/**
 * Fetch playout for a specific round and return match results.
 */
async function fetchPlayoutResults(leagueId, roundNumber, eventCategoryId) {
  const params = `parentEventCategoryId=${leagueId}`;
  const catParams = eventCategoryId ? `&eventCategoryId=${eventCategoryId}` : '';
  const data = await fetchAPI(
    `/round/${roundNumber}/playout?${params}${catParams}`,
    5000
  );

  if (!data?.matches || !Array.isArray(data.matches)) {
    return [];
  }

  const results = [];
  for (const m of data.matches) {
    if (!m.id) continue;
    const goals = m.goals || [];
    const lastGoal = goals.length > 0 ? goals[goals.length - 1] : null;
    results.push({
      matchId: m.id,
      homeTeam: m.homeTeam?.name || '',
      awayTeam: m.awayTeam?.name || '',
      scoreHome: lastGoal ? (lastGoal.homeScore || 0) : 0,
      scoreAway: lastGoal ? (lastGoal.awayScore || 0) : 0,
      minute: lastGoal ? (lastGoal.minute || 0) : 90,
      goals: goals,
      outcome: (() => {
        const h = lastGoal ? (lastGoal.homeScore || 0) : 0;
        const a = lastGoal ? (lastGoal.awayScore || 0) : 0;
        return h > a ? '1' : h < a ? '2' : 'X';
      })(),
    });
  }
  return results;
}

// ─── Database operations ───────────────────────────────────────────────────

/**
 * Ensure the match_results and scheduled_fetches tables exist.
 */
async function ensureTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS match_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      league_id TEXT NOT NULL,
      league_name TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      score_home INTEGER NOT NULL DEFAULT 0,
      score_away INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'X',
      minute INTEGER NOT NULL DEFAULT 90,
      goals JSONB DEFAULT '[]'::jsonb,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(league_id, round_number, match_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS scheduled_fetches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      league_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      event_category_id TEXT,
      expected_start TIMESTAMPTZ,
      fetch_after TIMESTAMPTZ NOT NULL,
      fetched BOOLEAN NOT NULL DEFAULT FALSE,
      fetched_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(league_id, round_number)
    )
  `;
  // Index for quick lookups
  await sql`CREATE INDEX IF NOT EXISTS idx_match_results_round ON match_results(league_id, round_number)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_fetches_pending ON scheduled_fetches(fetched) WHERE fetched = FALSE`;
}

/**
 * Check if a round already has results in match_results.
 */
async function hasExistingResults(sql, leagueId, roundNumber) {
  const rows = await sql`
    SELECT COUNT(*)::int AS cnt FROM match_results
    WHERE league_id = ${leagueId} AND round_number = ${roundNumber}
  `;
  return (rows[0]?.cnt || 0) > 0;
}

/**
 * Get pending scheduled fetches that are due (fetch_after <= now).
 */
async function getDueFetches(sql) {
  return sql`
    SELECT * FROM scheduled_fetches
    WHERE fetched = FALSE AND fetch_after <= NOW()
    ORDER BY fetch_after ASC
    LIMIT 20
  `;
}

/**
 * Schedule a fetch for a round at expectedStart + offsetSeconds.
 */
async function scheduleFetch(sql, leagueId, roundNumber, eventCategoryId, expectedStart, offsetSeconds = 100) {
  const fetchAfter = new Date(new Date(expectedStart).getTime() + offsetSeconds * 1000);
  try {
    await sql`
      INSERT INTO scheduled_fetches (league_id, round_number, event_category_id, expected_start, fetch_after)
      VALUES (${leagueId}, ${roundNumber}, ${eventCategoryId}, ${expectedStart}, ${fetchAfter})
      ON CONFLICT (league_id, round_number) DO NOTHING
    `;
    return true;
  } catch (e) {
    console.log(`[auto-playout] Schedule conflict for ${leagueId}/${roundNumber} (already scheduled)`);
    return false;
  }
}

/**
 * Mark a scheduled fetch as completed.
 */
async function markFetchDone(sql, id) {
  await sql`
    UPDATE scheduled_fetches
    SET fetched = TRUE, fetched_at = NOW()
    WHERE id = ${id}
  `;
}

/**
 * Store playout results in match_results (UPSERT).
 */
async function storeResults(sql, leagueId, leagueName, roundNumber, results) {
  let stored = 0;
  for (const r of results) {
    try {
      await sql`
        INSERT INTO match_results (league_id, league_name, round_number, match_id, home_team, away_team, score_home, score_away, outcome, minute, goals)
        VALUES (${leagueId}, ${leagueName}, ${roundNumber}, ${r.matchId}, ${r.homeTeam}, ${r.awayTeam}, ${r.scoreHome}, ${r.scoreAway}, ${r.outcome}, ${r.minute}, ${JSON.stringify(r.goals)})
        ON CONFLICT (league_id, round_number, match_id) DO UPDATE SET
          score_home = EXCLUDED.score_home,
          score_away = EXCLUDED.score_away,
          outcome = EXCLUDED.outcome,
          minute = EXCLUDED.minute,
          goals = EXCLUDED.goals,
          fetched_at = NOW()
      `;
      stored++;
    } catch (e) {
      console.log(`[auto-playout] Store error for match ${r.matchId}: ${e.message}`);
    }
  }
  return stored;
}

// ─── Main handler ───────────────────────────────────────────────────────

export default async function handler(req, res) {
  const startTime = Date.now();
  console.log('=== auto-playout v1 ===');

  try {
    // ── Auth: CRON key required ──
    const cronKey = req.headers['x-cron-key'] || '';
    const expectedCronKey = process.env.CRON_SECRET || '';

    // Also allow manual trigger via ?manual=true (for testing from dashboard)
    const isManual = req.query.manual === 'true';
    if (!isManual) {
      if (!expectedCronKey || !timingSafeEqual(cronKey, expectedCronKey)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const sql = createSql();
    await ensureTables(sql);

    // ── Phase 1: Discover rounds from all leagues ──
    const allRounds = [];
    const discoveryResults = await Promise.allSettled(
      LEAGUES.map(l => discoverRounds(l.id))
    );

    for (const result of discoveryResults) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allRounds.push(...result.value);
      }
    }

    console.log(`[auto-playout] Discovered ${allRounds.length} rounds across ${LEAGUES.length} leagues`);

    // ── Phase 2: Schedule new rounds (expectedStart + 100s) ──
    const now = Date.now();
    let scheduledCount = 0;

    for (const round of allRounds) {
      if (!round.expectedStart) continue;

      const expectedMs = new Date(round.expectedStart).getTime();
      // Only schedule rounds that haven't started yet (expectedStart > now - 60s)
      // and that start within the next 30 minutes
      const startsSoon = expectedMs > now - 60_000 && expectedMs < now + 30 * 60_000;

      if (startsSoon) {
        const scheduled = await scheduleFetch(
          sql,
          round.leagueId,
          round.roundNumber,
          round.eventCategoryId,
          round.expectedStart,
          100 // fetch 100 seconds after expectedStart
        );
        if (scheduled) scheduledCount++;
      }
    }

    // ── Phase 3: Execute due fetches ──
    const dueFetches = await getDueFetches(sql);
    console.log(`[auto-playout] ${dueFetches.length} due fetches, ${scheduledCount} newly scheduled`);

    let totalStored = 0;
    let totalFetched = 0;
    const fetchDetails = [];

    for (const fetch of dueFetches) {
      // Skip if results already exist
      const existing = await hasExistingResults(sql, fetch.league_id, fetch.round_number);
      if (existing) {
        await markFetchDone(sql, fetch.id);
        continue;
      }

      const results = await fetchPlayoutResults(
        fetch.league_id,
        fetch.round_number,
        fetch.event_category_id
      );

      if (results.length > 0) {
        const leagueName = LEAGUES.find(l => l.id === fetch.league_id)?.name || 'Unknown';
        const stored = await storeResults(sql, fetch.league_id, leagueName, fetch.round_number, results);
        totalStored += stored;
        fetchDetails.push({
          league: fetch.league_id,
          round: fetch.round_number,
          results: results.length,
          stored,
        });
        console.log(`[auto-playout] ${fetch.league_id}/${fetch.round_number}: ${results.length} results, ${stored} stored`);
      } else {
        // No results yet — don't mark as done, retry next minute
        console.log(`[auto-playout] ${fetch.league_id}/${fetch.round_number}: no results yet, retry later`);
        continue;
      }

      await markFetchDone(sql, fetch.id);
      totalFetched++;
    }

    // ── Phase 4: Auto-verify predictions if new results stored ──
    let verifyResult = null;
    if (totalStored > 0) {
      try {
        const verifyUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}/api/verify-predictions`
          : null;

        if (verifyUrl && expectedCronKey) {
          console.log(`[auto-playout] Triggering verify-predictions (${totalStored} new results)`);
          const verifyRes = await fetch(verifyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-cron-key': expectedCronKey,
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(30000),
          });
          verifyResult = verifyRes.ok ? await verifyRes.json() : { error: verifyRes.status };
          console.log(`[auto-playout] verify-predictions: ${JSON.stringify(verifyResult)}`);
        }
      } catch (e) {
        console.log(`[auto-playout] verify trigger error: ${e.message}`);
      }
    }

    // ── Cleanup old scheduled_fetches (older than 2 hours, fetched) ──
    await sql`
      DELETE FROM scheduled_fetches
      WHERE fetched = TRUE AND fetched_at < NOW() - INTERVAL '2 hours'
    `;

    await sql.end();

    const elapsed = Date.now() - startTime;
    console.log(`[auto-playout] Done in ${elapsed}ms: ${scheduledCount} scheduled, ${totalFetched} fetched, ${totalStored} results stored`);

    return res.status(200).json({
      success: true,
      version: 'v1',
      elapsed,
      roundsDiscovered: allRounds.length,
      newlyScheduled: scheduledCount,
      dueFetches: dueFetches.length,
      fetched: totalFetched,
      resultsStored: totalStored,
      fetchDetails,
      verifyResult,
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[auto-playout] Error (${elapsed}ms):`, error);
    return res.status(500).json({ error: error.message, elapsed });
  }
}
