// Vercel Serverless Function — auto-playout v3 (ESM)
// Cron job: fetches playout results at multiple intervals after expectedStart
//
// Strategy (v3 — async fire-and-forget):
//   Responds 202 Accepted immediately, then runs all work in background
//   using Vercel's waitUntil. This prevents cron-job.org timeouts.
//
//   Virtual matches last ~3-4 real minutes (90 virtual minutes).
//   Goals happen throughout, so we need multiple fetches:
//     Phase 1: expectedStart + 100s  → early score (captures fast goals)
//     Phase 2: expectedStart + 180s  → mid-match score
//     Phase 3: expectedStart + 260s  → final score (triggers verification)
//
//   Each phase UPSERTs into match_results (latest scores win).
//   verify-predictions is triggered ONLY after phase 3 succeeds.
//
// Vercel Cron: runs every minute via vercel.json crons config
// External: cron-job.org calls this endpoint every minute

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

// Fetch phases: offset in seconds after expectedStart
// Phase 1 = early, Phase 2 = mid-match, Phase 3 = final
const FETCH_PHASES = [
  { phase: 1, offset: 100 },  // +1m40s — match just started
  { phase: 2, offset: 180 },  // +3m00s — mid-match
  { phase: 3, offset: 260 },  // +4m20s — end of match (final score)
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

// Timing-safe comparison
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
 * and eventCategoryId.
 */
async function discoverRounds(leagueId) {
  const data = await fetchAPI(`/${leagueId}/matches`, 6000);
  if (!data?.rounds) return [];

  const rounds = [];
  for (const rd of data.rounds) {
    const roundNum = rd.roundNumber || 0;
    if (roundNum <= 0) continue;

    rounds.push({
      leagueId,
      leagueName: LEAGUES.find(l => l.id === leagueId)?.name || 'Unknown',
      roundNumber: roundNum,
      eventCategoryId: rd.eventCategoryId || null,
      expectedStart: rd.expectedStart || null,
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
 * Ensure tables exist (v2: fetch_phase column, updated UNIQUE constraint).
 */
async function ensureTables(sql) {
  // match_results: same as v1
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

  // scheduled_fetches: v2 — supports multiple phases per round
  await sql`
    CREATE TABLE IF NOT EXISTS scheduled_fetches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      league_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      event_category_id TEXT,
      expected_start TIMESTAMPTZ,
      fetch_after TIMESTAMPTZ NOT NULL,
      fetch_phase INTEGER NOT NULL DEFAULT 1,
      fetched BOOLEAN NOT NULL DEFAULT FALSE,
      fetched_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(league_id, round_number, fetch_phase)
    )
  `;

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_match_results_round ON match_results(league_id, round_number)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_fetches_pending ON scheduled_fetches(fetch_after) WHERE fetched = FALSE`;

  // ── Migration from v1 → v2 ──
  // If the v1 table exists without fetch_phase column, add it
  try {
    await sql`ALTER TABLE scheduled_fetches ADD COLUMN IF NOT EXISTS fetch_phase INTEGER NOT NULL DEFAULT 1`;
    // Drop old v1 constraint and add new v2 constraint
    await sql`
      ALTER TABLE scheduled_fetches
      DROP CONSTRAINT IF EXISTS scheduled_fetches_league_id_round_number_key
    `;
    await sql`
      ALTER TABLE scheduled_fetches
      ADD CONSTRAINT scheduled_fetches_league_round_phase_uniq
      UNIQUE (league_id, round_number, fetch_phase)
    `;
  } catch (e) {
    console.log(`[auto-playout] Migration note: ${e.message}`);
  }
}

/**
 * Schedule ALL 3 phases for a round (expectedStart + offsets).
 */
async function scheduleRoundPhases(sql, leagueId, roundNumber, eventCategoryId, expectedStart) {
  let scheduled = 0;
  for (const { phase, offset } of FETCH_PHASES) {
    const fetchAfter = new Date(new Date(expectedStart).getTime() + offset * 1000);
    try {
      await sql`
        INSERT INTO scheduled_fetches (league_id, round_number, event_category_id, expected_start, fetch_after, fetch_phase)
        VALUES (${leagueId}, ${roundNumber}, ${eventCategoryId}, ${expectedStart}, ${fetchAfter}, ${phase})
        ON CONFLICT (league_id, round_number, fetch_phase) DO NOTHING
      `;
      scheduled++;
    } catch {
      // Already scheduled (normal)
    }
  }
  return scheduled;
}

/**
 * Get pending scheduled fetches that are due (fetch_after <= now).
 */
async function getDueFetches(sql) {
  return sql`
    SELECT * FROM scheduled_fetches
    WHERE fetched = FALSE AND fetch_after <= NOW()
    ORDER BY fetch_after ASC, fetch_phase ASC
    LIMIT 30
  `;
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
 * Store playout results in match_results (UPSERT — latest scores win).
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

/**
 * Check if phase 3 (final) has been fetched for a given round.
 */
async function isFinalPhaseDone(sql, leagueId, roundNumber) {
  const rows = await sql`
    SELECT fetched FROM scheduled_fetches
    WHERE league_id = ${leagueId} AND round_number = ${roundNumber} AND fetch_phase = 3
    LIMIT 1
  `;
  return rows.length > 0 && rows[0].fetched === true;
}

// ─── Background worker (all the heavy lifting) ───────────────────────

async function runPlayout(expectedCronKey) {
  const startTime = Date.now();
  console.log('=== auto-playout v3 (background worker started) ===');

  try {
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

    // ── Phase 2: Schedule new rounds (3 phases each) ──
    const now = Date.now();
    let scheduledCount = 0;

    for (const round of allRounds) {
      if (!round.expectedStart) continue;

      const expectedMs = new Date(round.expectedStart).getTime();
      // Schedule rounds that start within the next 30 minutes (skip timing gate in manual mode)
      const startsSoon = expectedMs > now - 30_000 && expectedMs < now + 30 * 60_000;

      if (startsSoon || isManual) {
        const count = await scheduleRoundPhases(
          sql,
          round.leagueId,
          round.roundNumber,
          round.eventCategoryId,
          round.expectedStart
        );
        if (count > 0) {
          scheduledCount += count;
          console.log(`[auto-playout] Scheduled ${count} phases for ${round.leagueId}/${round.roundNumber} (starts ${round.expectedStart})`);
        }
      }
    }

    // ── Phase 3: Execute due fetches ──
    const dueFetches = await getDueFetches(sql);
    console.log(`[auto-playout] ${dueFetches.length} due fetches, ${scheduledCount} newly scheduled`);

    let totalStored = 0;
    let phase3Done = [];  // Track which (league, round) completed phase 3
    const fetchDetails = [];

    for (const fetch of dueFetches) {
      const results = await fetchPlayoutResults(
        fetch.league_id,
        fetch.round_number,
        fetch.event_category_id
      );

      if (results.length > 0) {
        const leagueName = LEAGUES.find(l => l.id === fetch.league_id)?.name || 'Unknown';
        const stored = await storeResults(sql, fetch.league_id, leagueName, fetch.round_number, results);
        totalStored += stored;

        const avgMinute = results.reduce((s, r) => s + (r.minute || 0), 0) / results.length;
        fetchDetails.push({
          league: fetch.league_id,
          round: fetch.round_number,
          phase: fetch.fetch_phase,
          results: results.length,
          stored,
          avgMinute: Math.round(avgMinute),
        });
        console.log(`[auto-playout] ${fetch.league_id}/${fetch.round_number} phase ${fetch.fetch_phase}: ${results.length} results (${stored} stored, avg minute: ${Math.round(avgMinute)})`);

        await markFetchDone(sql, fetch.id);

        // Track phase 3 completions for verification trigger
        if (fetch.fetch_phase === 3) {
          phase3Done.push({ leagueId: fetch.league_id, roundNumber: fetch.round_number });
        }
      } else {
        // No results yet — don't mark as done, retry next minute
        console.log(`[auto-playout] ${fetch.league_id}/${fetch.round_number} phase ${fetch.fetch_phase}: no results, retry later`);
        continue;
      }
    }

    // ── Phase 4: Trigger verify-predictions ONLY after phase 3 completions ──
    if (phase3Done.length > 0) {
      try {
        const verifyUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}/api/verify-predictions`
          : null;

        if (verifyUrl && expectedCronKey) {
          console.log(`[auto-playout] Triggering verify-predictions (${phase3Done.length} rounds completed phase 3)`);
          const verifyRes = await fetch(verifyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-cron-key': expectedCronKey,
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(30000),
          });
          const verifyResult = verifyRes.ok ? await verifyRes.json() : { error: verifyRes.status };
          console.log(`[auto-playout] verify-predictions result: ${JSON.stringify(verifyResult)}`);
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
    console.log(`[auto-playout] Background worker done in ${elapsed}ms: ${scheduledCount} scheduled, ${dueFetches.length} due, ${totalStored} results stored, ${phase3Done.length} phase3 done`);

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[auto-playout] Background worker error (${elapsed}ms):`, error);
  }
}

// ─── Main handler (responds immediately, runs work in background) ──────

export default async function handler(req, res) {
  console.log('=== auto-playout v3 (fire-and-forget) ===');

  try {
    // ── Auth: CRON key ALWAYS required (no bypass, even in manual mode) ──
    // Accept key via header (x-cron-key) OR query param (?cron_key=xxx).
    // Header is preferred (cron-job.org paid), query param is fallback (free plan).
    const cronKey = req.headers['x-cron-key'] || req.query.cron_key || '';
    const expectedCronKey = process.env.CRON_SECRET || '';

    // ?manual=true only skips timing gates (e.g. "starts within 30 min"), never auth.
    // CRON key is mandatory in ALL cases (cron-job.org, Vercel Cron, manual, dev).
    if (!expectedCronKey || !timingSafeEqual(cronKey, expectedCronKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const isManual = req.query.manual === 'true';

    // ── Respond 202 Accepted immediately ──
    res.status(202).json({
      accepted: true,
      version: 'v3-fire-and-forget',
      message: 'Playout processing started in background',
    });

    // ── Run heavy work in background using Vercel waitUntil ──
    // This keeps the function alive after the response is sent
    // Supports up to ~60s of background execution on Hobby plan
    res.unstable_waitUntil(runPlayout(expectedCronKey));

  } catch (error) {
    console.error('[auto-playout] Handler error:', error);
    return res.status(500).json({ error: error.message });
  }
}
