// Vercel Serverless Function — Predictions CRUD
// Replaces ALL direct Neon SQL from frontend (storage.ts)
// All SQL queries are server-side only

import postgres from 'postgres';
import { setCorsHeaders, isOriginAllowed } from './_lib/cors.js';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

const DEVICE_ID_RE = /^dev-\d+-[a-z0-9]+$/;
const MAX_BODY_BYTES = 100 * 1024; // 100KB

// Rate limiting: 30 requests per minute per IP
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowKey = Math.floor(now / RATE_LIMIT_WINDOW_MS);
  const key = `${ip}:${windowKey}`;
  const record = rateLimitStore.get(key);

  if (!record || now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (record.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((record.firstAttempt + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - record.count };
}

// Sanitize string: strip HTML tags, limit length
function sanitize(v, maxLen = 200) {
  return String(v || '').replace(/<[^>]*>/g, '').substring(0, maxLen);
}

// Clamp a number to [min, max]
function clampNum(v, min = 0, max = 100) {
  return typeof v === 'number' && !isNaN(v) ? Math.min(Math.max(v, min), max) : null;
}

// Validate and sanitize prediction fields for INSERT
function validatePrediction(body) {
  const errors = [];

  if (!body.home_team || typeof body.home_team !== 'string' || body.home_team.trim().length === 0) {
    errors.push('home_team is required');
  }
  if (!body.away_team || typeof body.away_team !== 'string' || body.away_team.trim().length === 0) {
    errors.push('away_team is required');
  }
  if (!body.prediction || !['1', 'X', '2'].includes(body.prediction)) {
    errors.push('prediction must be 1, X, or 2');
  }
  if (!body.device_id || !DEVICE_ID_RE.test(body.device_id)) {
    errors.push('device_id is required and must match format dev-\d+-[a-z0-9]+');
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      match_id: body.match_id ? parseInt(body.match_id, 10) || null : null,
      home_team: sanitize(body.home_team, 200),
      away_team: sanitize(body.away_team, 200),
      league: body.league ? sanitize(body.league, 200) : null,
      league_id: body.league_id ? String(body.league_id).substring(0, 20) : null,
      round: body.round ? parseInt(body.round, 10) || null : null,
      odd_home: clampNum(body.odd_home, 0, 100),
      odd_draw: clampNum(body.odd_draw, 0, 100),
      odd_away: clampNum(body.odd_away, 0, 100),
      prob_home: clampNum(body.prob_home, 0, 1),
      prob_draw: clampNum(body.prob_draw, 0, 1),
      prob_away: clampNum(body.prob_away, 0, 1),
      prediction: body.prediction,
      confidence: clampNum(body.confidence, 0, 100),
      predicted_home_score: typeof body.predicted_home_score === 'number' ? Math.min(Math.max(body.predicted_home_score, 0), 99) : null,
      predicted_away_score: typeof body.predicted_away_score === 'number' ? Math.min(Math.max(body.predicted_away_score, 0), 99) : null,
      predicted_score: body.predicted_score ? String(body.predicted_score).substring(0, 10) : null,
      gg_result: body.gg_result ? String(body.gg_result).substring(0, 20) : null,
      total_goals: typeof body.total_goals === 'number' ? Math.min(Math.max(body.total_goals, 0), 30) : null,
      parity: body.parity ? String(body.parity).substring(0, 20) : null,
      over_under_15: body.over_under_15 ? String(body.over_under_15).substring(0, 20) : null,
      over_under_25: body.over_under_25 ? String(body.over_under_25).substring(0, 20) : null,
      over_under_35: body.over_under_35 ? String(body.over_under_35).substring(0, 20) : null,
      prob_gg: clampNum(body.prob_gg, 0, 1),
      prob_gn: clampNum(body.prob_gn, 0, 1),
      btts_prob: clampNum(body.btts_prob, 0, 1),
      over25_prob: clampNum(body.over25_prob, 0, 1),
      first_half_goal_prob: clampNum(body.first_half_goal_prob, 0, 1),
      expected_goals: clampNum(body.expected_goals, 0, 20),
      winner_1x2: body.winner_1x2 ? String(body.winner_1x2).substring(0, 100) : null,
      device_id: body.device_id,
      status: 'pending',
      home: body.home ? String(body.home).substring(0, 100) : null,
      away: body.away ? String(body.away).substring(0, 100) : null,
      score_home: typeof body.score_home === 'number' ? Math.min(Math.max(body.score_home, 0), 99) : null,
      score_away: typeof body.score_away === 'number' ? Math.min(Math.max(body.score_away, 0), 99) : null,
      exact_score: body.exact_score ? String(body.exact_score).substring(0, 10) : null,
    },
  };
}

// Map snake_case DB row to camelCase for frontend consumption
function mapToCamelCase(row) {
  return {
    id: row.id,
    matchId: row.match_id,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    league: row.league,
    leagueId: row.league_id,
    round: row.round,
    oddHome: row.odd_home,
    oddDraw: row.odd_draw,
    oddAway: row.odd_away,
    probHome: row.prob_home,
    probDraw: row.prob_draw,
    probAway: row.prob_away,
    prediction: row.prediction,
    confidence: row.confidence,
    predictedHomeScore: row.predicted_home_score,
    predictedAwayScore: row.predicted_away_score,
    predictedScore: row.predicted_score,
    ggResult: row.gg_result,
    totalGoals: row.total_goals,
    parity: row.parity,
    overUnder15: row.over_under_15,
    overUnder25: row.over_under_25,
    overUnder35: row.over_under_35,
    probGg: row.prob_gg,
    probGn: row.prob_gn,
    bttsProb: row.btts_prob,
    over25Prob: row.over25_prob,
    firstHalfGoalProb: row.first_half_goal_prob,
    expectedGoals: row.expected_goals,
    winner1x2: row.winner_1x2,
    deviceId: row.device_id,
    status: row.status,
    home: row.home,
    away: row.away,
    scoreHome: row.score_home,
    scoreAway: row.score_away,
    exactScore: row.exact_score,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
    actualOutcome: row.actual_outcome,
    actualScore: row.actual_score,
    actualHomeScore: row.actual_home_score,
    actualAwayScore: row.actual_away_score,
  };
}

export default async function handler(req, res) {
  // CORS
  setCorsHeaders(req, res, 'GET, POST, DELETE, OPTIONS', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.retryAfter));
    return res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
  }

  if (!NEON_DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  // ─── GET: Read predictions by deviceId ──────────────────────────────────────
  if (req.method === 'GET') {
    const deviceId = req.query.device_id || '';
    if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
      return res.status(400).json({ success: false, error: 'Valid device_id query parameter is required' });
    }

    try {
      const sql = postgres(NEON_DATABASE_URL);
      const rows = await sql`
        SELECT * FROM predictions
        WHERE device_id = ${deviceId}
        ORDER BY created_at DESC
        LIMIT 200
      `;
      await sql.end();
      return res.status(200).json({
        success: true,
        predictions: rows.map(mapToCamelCase),
      });
    } catch (err) {
      console.error('[predictions GET] Error:', err.message);
      return res.status(500).json({ success: false, error: 'Failed to fetch predictions' });
    }
  }

  // ─── POST: Insert prediction ────────────────────────────────────────────────
  if (req.method === 'POST') {
    // Body size limit (100KB)
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return res.status(413).json({ success: false, error: 'Request body too large' });
    }

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }

    const validation = validatePrediction(body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: validation.errors });
    }

    const d = validation.data;

    try {
      const sql = postgres(NEON_DATABASE_URL);
      const result = await sql`
        INSERT INTO predictions (
          match_id, home_team, away_team, league, league_id, round,
          odd_home, odd_draw, odd_away,
          prob_home, prob_draw, prob_away,
          prediction, confidence,
          predicted_home_score, predicted_away_score, predicted_score,
          gg_result, total_goals, parity,
          over_under_15, over_under_25, over_under_35,
          prob_gg, prob_gn, btts_prob, over25_prob,
          first_half_goal_prob, expected_goals,
          winner_1x2,
          device_id, status, home, away,
          score_home, score_away, exact_score
        ) VALUES (
          ${d.match_id}, ${d.home_team}, ${d.away_team}, ${d.league}, ${d.league_id}, ${d.round},
          ${d.odd_home}, ${d.odd_draw}, ${d.odd_away},
          ${d.prob_home}, ${d.prob_draw}, ${d.prob_away},
          ${d.prediction}, ${d.confidence},
          ${d.predicted_home_score}, ${d.predicted_away_score}, ${d.predicted_score},
          ${d.gg_result}, ${d.total_goals}, ${d.parity},
          ${d.over_under_15}, ${d.over_under_25}, ${d.over_under_35},
          ${d.prob_gg}, ${d.prob_gn}, ${d.btts_prob}, ${d.over25_prob},
          ${d.first_half_goal_prob}, ${d.expected_goals},
          ${d.winner_1x2},
          ${d.device_id}, ${d.status}, ${d.home}, ${d.away},
          ${d.score_home}, ${d.score_away}, ${d.exact_score}
        )
        RETURNING *
      `;
      await sql.end();
      return res.status(201).json({ success: true, prediction: mapToCamelCase(result[0]) });
    } catch (err) {
      console.error('[predictions POST] Error:', err.message);
      if (err?.code === '23505') {
        return res.status(409).json({ success: false, error: 'Duplicate prediction' });
      }
      return res.status(500).json({ success: false, error: 'Failed to save prediction' });
    }
  }

  // ─── DELETE: Delete predictions ─────────────────────────────────────────────
  if (req.method === 'DELETE') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }

    const deviceId = body.device_id || '';
    if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
      return res.status(400).json({ success: false, error: 'Valid device_id is required' });
    }

    try {
      const sql = postgres(NEON_DATABASE_URL);

      // If prediction_id provided, delete only that specific prediction (with ownership check)
      if (body.prediction_id) {
        const predictionId = parseInt(body.prediction_id, 10);
        if (!predictionId || isNaN(predictionId)) {
          await sql.end();
          return res.status(400).json({ success: false, error: 'Invalid prediction_id' });
        }
        const result = await sql`
          DELETE FROM predictions
          WHERE id = ${predictionId} AND device_id = ${deviceId}
        `;
        await sql.end();
        if (result.count === 0) {
          return res.status(404).json({ success: false, error: 'Prediction not found' });
        }
        return res.status(200).json({ success: true, deleted: result.count });
      }

      // No prediction_id → delete ALL predictions for this device (clear history)
      const result = await sql`
        DELETE FROM predictions
        WHERE device_id = ${deviceId}
      `;
      await sql.end();
      return res.status(200).json({ success: true, deleted: result.count });
    } catch (err) {
      console.error('[predictions DELETE] Error:', err.message);
      return res.status(500).json({ success: false, error: 'Failed to delete predictions' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
