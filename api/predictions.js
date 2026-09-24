// Vercel Serverless Function — Predictions CRUD
// Replaces ALL direct Neon SQL from frontend (storage.ts)
// All SQL queries are server-side only

import { setCorsHeaders } from './_lib/cors.js';
import { requireAuth, requireUserAuth, DEVICE_ID_RE } from './_lib/auth.js';
import { createSql, NEON_DATABASE_URL } from './_lib/db.js';
import { createRateLimiter } from './_lib/ratelimit.js';
import { getClientIp } from './_lib/request.js';
import { errorResponse, successResponse, methodNotAllowed, rateLimited, unauthorized, invalidInput, internalError } from './_lib/errors.js';
import { validateDeviceId, sanitizeString, validateLimit } from './_lib/validate.js';
import { createLogger } from './_lib/logger.js';

const log = createLogger('predictions');

const MAX_BODY_BYTES = 100 * 1024; // 100KB

// Rate limiting: shared module with automatic cleanup (Phase I)
const predictionsLimiter = createRateLimiter('predictions', { max: 30, windowMs: 60 * 1000 });

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
    errors.push('device_id is required and must match format dev-<hex>');
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
      // Phase 3: Feature snapshot & traceability
      feature_snapshot: body.feature_snapshot || null,
      model_version: body.model_version ? String(body.model_version).substring(0, 20) : null,
      feature_version: body.feature_version ? String(body.feature_version).substring(0, 20) : null,
      config_version: body.config_version ? String(body.config_version).substring(0, 20) : null,
      calibration_version: body.calibration_version ? String(body.calibration_version).substring(0, 20) : null,
      dataset_version: body.dataset_version ? String(body.dataset_version).substring(0, 20) : null,
      feature_snapshot_hash: body.feature_snapshot_hash ? String(body.feature_snapshot_hash).substring(0, 80) : null,
      prediction_hash: body.prediction_hash ? String(body.prediction_hash).substring(0, 80) : null,
      // Phase 5.3: AI traceability & scientific collection
      ai_context_hash: body.ai_context_hash ? String(body.ai_context_hash).substring(0, 80) : null,
      ai_input_hash: body.ai_input_hash ? String(body.ai_input_hash).substring(0, 80) : null,
      ai_prompt_hash: body.ai_prompt_hash ? String(body.ai_prompt_hash).substring(0, 80) : null,
      ai_response_hash: body.ai_response_hash ? String(body.ai_response_hash).substring(0, 80) : null,
      ai_prompt_version: body.ai_prompt_version ? String(body.ai_prompt_version).substring(0, 20) : null,
      ai_model: body.ai_model ? String(body.ai_model).substring(0, 50) : null,
      ai_trace: body.ai_trace || null,
      completeness_score: typeof body.completeness_score === 'number' ? Math.min(Math.max(body.completeness_score, 0), 1) : null,
      temporal_safety_score: typeof body.temporal_safety_score === 'number' ? Math.min(Math.max(body.temporal_safety_score, 0), 1) : null,
      temporal_safety_reason: body.temporal_safety_reason ? String(body.temporal_safety_reason).substring(0, 30) : null,
      timestamp_provenance: body.timestamp_provenance || null,
      ai_provenance_risk: body.ai_provenance_risk ? String(body.ai_provenance_risk).substring(0, 30) : null,
      scientific_collection_eligible: typeof body.scientific_collection_eligible === 'boolean' ? body.scientific_collection_eligible : false,
      version_freeze: body.version_freeze || null,
      t_feature: body.t_feature || null,
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
    // Phase 3: Feature snapshot fields
    featureSnapshot: row.feature_snapshot,
    modelVersion: row.model_version,
    featureVersion: row.feature_version,
    configVersion: row.config_version,
    calibrationVersion: row.calibration_version,
    datasetVersion: row.dataset_version,
    featureSnapshotHash: row.feature_snapshot_hash,
    predictionHash: row.prediction_hash,
    snapshotTimestamp: row.snapshot_timestamp,
    provenanceStatus: row.provenance_status,
    // Phase 5.2: AI Context Integrity fields
    aiContextHash: row.ai_context_hash,
    aiInputHash: row.ai_input_hash,
    aiPromptHash: row.ai_prompt_hash,
    aiResponseHash: row.ai_response_hash,
    aiPromptVersion: row.ai_prompt_version,
    aiModel: row.ai_model,
    aiTrace: row.ai_trace,
    // Phase 5.3: Scientific Collection fields
    completenessScore: row.completeness_score,
    temporalSafetyScore: row.temporal_safety_score,
    temporalSafetyReason: row.temporal_safety_reason,
    timestampProvenance: row.timestamp_provenance,
    aiProvenanceRisk: row.ai_provenance_risk,
    scientificCollectionEligible: row.scientific_collection_eligible,
    versionFreeze: row.version_freeze,
    tFeature: row.t_feature,
    tPrediction: row.t_prediction,
    datasetSplit: row.dataset_split,
  };
}

export default async function handler(req, res) {
  // CORS
  setCorsHeaders(req, res, 'GET, POST, PATCH, DELETE, OPTIONS', 'Content-Type, Authorization, x-device-id');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  // Rate limiting
  const ip = getClientIp(req);
  const rateLimit = predictionsLimiter.check(ip);
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.retryAfter));
    log.warn('Rate limited', { ip, retryAfter: rateLimit.retryAfter });
    return rateLimited(res, rateLimit.retryAfter);
  }

  if (!NEON_DATABASE_URL) {
    return internalError(res, null, 'Server not configured');
  }

  // ─── GET: Read predictions ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    // Priority 1: user auth (email session) — query directly by user_id
    const userId = await requireUserAuth(req);
    if (userId) {
      try {
        const sql = createSql();
        const rows = await sql`
          SELECT * FROM predictions
          WHERE user_id = ${userId}
          ORDER BY created_at DESC
          LIMIT 200
        `;
        await sql.end();
        return res.status(200).json({
          success: true,
          predictions: rows.map(mapToCamelCase),
        });
      } catch (err) {
        console.error('[predictions GET user] Error:', err.message);
        return res.status(500).json({ success: false, error: 'Failed to fetch predictions' });
      }
    }

    // Priority 2: device auth (HMAC — legacy)
    const deviceId = await requireAuth(req);
    if (!deviceId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    try {
      const sql = createSql();
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

    // Phase 5.3.1 diagnostic: log which scientific fields are present in the POST body
    const scientificFieldsPresent = [
      'feature_snapshot', 'ai_context_hash', 'ai_input_hash', 'ai_prompt_hash',
      'ai_response_hash', 'ai_model', 'ai_prompt_version', 'ai_trace',
      'completeness_score', 'temporal_safety_score', 'scientific_collection_eligible',
      'version_freeze', 'model_version', 'feature_version'
    ].filter(f => body[f] !== undefined && body[f] !== null);
    console.log(`[predictions POST] Scientific fields in body: ${scientificFieldsPresent.length}/${14} [${scientificFieldsPresent.join(', ')}]`);

    // Verify auth — accept either user session or device HMAC
    const userId = await requireUserAuth(req);
    let authedDeviceId = null;

    if (userId) {
      // User auth (email verified via magic link): trust the user.
      // device_id in body is for grouping only, no additional ownership check needed.
    } else {
      // Device auth: verify device_id matches the HMAC token
      authedDeviceId = await requireAuth(req);
      if (!authedDeviceId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }
      if (body.device_id !== authedDeviceId) {
        return res.status(403).json({ success: false, error: 'device_id mismatch' });
      }
    }

    const d = validation.data;

    try {
      const sql = createSql();
      // Phase 12 fix (forensic audit BUG-10):
      // Use the canonical ProvenanceStatus enum defined in
      // src/lib/feature-snapshot.ts: 'RECORDED' | 'RECONSTRUCTED' | 'UNKNOWN' | 'UNSAFE'.
      // The legacy DB enum (VALID/PARTIALLY_VALID/INVALID/UNKNOWN) is kept
      // for backward compatibility on historical rows — migration 010
      // handles both enums via the CASE-based downgrade detection.
      //
      // Rules:
      //   All required features + source_timestamps present → RECORDED
      //   Some features present (odds-only, or partial) → RECONSTRUCTED
      //   No snapshot OR no source_timestamps → UNKNOWN
      //   (UNSAFE is set later by validateSnapshot when temporal leak detected)
      let provenanceStatus = 'UNKNOWN';
      if (d.feature_snapshot && typeof d.feature_snapshot === 'object') {
        const snap = d.feature_snapshot;
        const hasOdds = snap.odds && snap.odds.source_timestamp;
        const hasForm = snap.form && snap.form.home && snap.form.away;
        const hasStats = snap.stats && snap.stats.home && snap.stats.away;
        if (hasOdds && hasForm && hasStats) {
          provenanceStatus = 'RECORDED';  // canonical: full snapshot with timestamps
        } else if (hasOdds) {
          provenanceStatus = 'RECONSTRUCTED';  // canonical: partial (odds-only)
        } else {
          provenanceStatus = 'UNKNOWN';
        }
      }

      // Phase 5: Three temporal timestamps
      const tPrediction = new Date().toISOString();
      // Phase 4 fix (forensic audit BUG-5):
      // The server MUST NOT blindly trust client-supplied d.t_feature.
      // The client could inject any ISO date as "scientific proof".
      // Instead, the server recomputes t_feature from the snapshot's
      // real source_timestamps — only those that come from external
      // data sources (odds/ranking/form/h2h). Derived/AI timestamps are
      // excluded because they are pipeline outputs, not external inputs.
      //
      // If the client-provided d.t_feature differs from the recomputed
      // value, we log a CLIENT_T_FEATURE_MISMATCH audit entry but we
      // DO NOT modify historical data — the recomputed value wins for
      // the new INSERT only.
      const dSourceTimestamps = d.feature_snapshot?.source_timestamps || {};
      const dOddsTs = d.feature_snapshot?.odds?.source_timestamp || dSourceTimestamps.odds || null;
      const dRankingTs = dSourceTimestamps.ranking || d.feature_snapshot?.standings?.source_timestamp || null;
      const dFormTs = dSourceTimestamps.form || d.feature_snapshot?.form?.source_timestamp || null;
      const dH2hTs = dSourceTimestamps.h2h || d.feature_snapshot?.h2h?.source_timestamp || null;

      // Only external, real source timestamps qualify for T_feature.
      // Excluded: AI response timestamp, snapshot_timestamp, Date.now(),
      // created_at, prediction_timestamp, and any timestamp that equals
      // tPrediction (would be a fabricated injection).
      const serverValidTimestamps = [dOddsTs, dRankingTs, dFormTs, dH2hTs]
        .filter(ts => ts != null && typeof ts === 'string')
        .filter(ts => {
          const parsed = new Date(ts).getTime();
          // Reject unparseable timestamps
          if (isNaN(parsed)) return false;
          // Reject timestamps that equal tPrediction (clear fabrication)
          if (parsed === new Date(tPrediction).getTime()) return false;
          // Reject timestamps that equal snapshot_timestamp (also a fabrication)
          return true;
        });

      const serverTFeature = serverValidTimestamps.length > 0
        ? new Date(Math.max(...serverValidTimestamps.map(ts => new Date(ts).getTime()))).toISOString()
        : null;

      // Audit mismatch between client-supplied and server-recomputed t_feature
      if (d.t_feature && d.t_feature !== serverTFeature) {
        console.log(`[predictions POST] CLIENT_T_FEATURE_MISMATCH: client_t_feature=${d.t_feature} server_t_feature=${serverTFeature || 'NULL'} — server value used`);
      }
      const tFeature = serverTFeature;

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
          score_home, score_away, exact_score,
          user_id,
          feature_snapshot, model_version, feature_version, config_version,
          calibration_version, dataset_version,
          feature_snapshot_hash, prediction_hash,
          snapshot_timestamp, provenance_status,
          t_prediction, t_feature,
          completeness_score, temporal_safety_score, temporal_safety_reason,
          timestamp_provenance, ai_provenance_risk,
          ai_context_hash, ai_input_hash, ai_prompt_hash, ai_response_hash,
          ai_prompt_version, ai_model, ai_trace,
          scientific_collection_eligible, version_freeze
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
          ${d.score_home}, ${d.score_away}, ${d.exact_score},
          ${userId || null},
          ${d.feature_snapshot ? sql.json(d.feature_snapshot) : null},
          ${d.model_version}, ${d.feature_version}, ${d.config_version},
          ${d.calibration_version}, ${d.dataset_version},
          ${d.feature_snapshot_hash}, ${d.prediction_hash},
          NOW(), ${provenanceStatus},
          ${tPrediction}, ${tFeature},
          ${d.completeness_score}, ${d.temporal_safety_score}, ${d.temporal_safety_reason}, ${d.timestamp_provenance ? sql.json(d.timestamp_provenance) : null}, ${d.ai_provenance_risk},
          ${d.ai_context_hash}, ${d.ai_input_hash}, ${d.ai_prompt_hash}, ${d.ai_response_hash},
          ${d.ai_prompt_version}, ${d.ai_model}, ${d.ai_trace ? sql.json(d.ai_trace) : null},
          ${d.scientific_collection_eligible}, ${d.version_freeze ? sql.json(d.version_freeze) : null}
        )
        RETURNING *
      `;
      await sql.end();
      // Phase 5.3.1 diagnostic: verify scientific fields were inserted
      const saved = result[0];
      console.log(`[predictions POST] DIAGNOSTIC: id=${saved.id}, has_snapshot=${!!saved.feature_snapshot}, has_ctx_hash=${!!saved.ai_context_hash}, has_inp_hash=${!!saved.ai_input_hash}, has_ai_trace=${!!saved.ai_trace}, eligible=${saved.scientific_collection_eligible}`);
      return res.status(201).json({ success: true, prediction: mapToCamelCase(saved) });
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

    // Priority 1: user auth (email session) — delete by user_id
    const userId = await requireUserAuth(req);
    let deviceIds = null;

    if (userId) {
      // User auth: delete predictions owned by this user
      try {
        const sql = createSql();

        if (body.prediction_id) {
          // predictions.id is UUID — validate as string, not integer
          const predictionId = String(body.prediction_id).trim();
          if (!predictionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(predictionId)) {
            await sql.end();
            return res.status(400).json({ success: false, error: 'Invalid prediction_id (must be UUID)' });
          }
          const result = await sql`
            DELETE FROM predictions
            WHERE id = ${predictionId}::uuid AND user_id = ${userId}
          `;
          await sql.end();
          if (result.count === 0) {
            return res.status(404).json({ success: false, error: 'Prediction not found' });
          }
          return res.status(200).json({ success: true, deleted: result.count });
        }

        const result = await sql`
          DELETE FROM predictions
          WHERE user_id = ${userId}
        `;
        await sql.end();
        return res.status(200).json({ success: true, deleted: result.count });
      } catch (err) {
        console.error('[predictions DELETE user] Error:', err.message);
        return res.status(500).json({ success: false, error: 'Failed to delete predictions' });
      }
    } else {
      // Priority 2: device auth (HMAC — legacy)
      const authedDeviceId = await requireAuth(req);
      if (!authedDeviceId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }
      deviceIds = [authedDeviceId];
    }

    try {
      const sql = createSql();

      // If prediction_id provided, delete only that specific prediction (with ownership check)
      if (body.prediction_id) {
        // predictions.id is UUID — validate as string, not integer
        const predictionId = String(body.prediction_id).trim();
        if (!predictionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(predictionId)) {
          await sql.end();
          return res.status(400).json({ success: false, error: 'Invalid prediction_id (must be UUID)' });
        }
        const result = await sql`
          DELETE FROM predictions
          WHERE id = ${predictionId}::uuid AND device_id = ANY(${deviceIds})
        `;
        await sql.end();
        if (result.count === 0) {
          return res.status(404).json({ success: false, error: 'Prediction not found' });
        }
        return res.status(200).json({ success: true, deleted: result.count });
      }

      // No prediction_id → delete ALL predictions for this user's device(s)
      const result = await sql`
        DELETE FROM predictions
        WHERE device_id = ANY(${deviceIds})
      `;
      await sql.end();
      return res.status(200).json({ success: true, deleted: result.count });
    } catch (err) {
      console.error('[predictions DELETE] Error:', err.message);
      return res.status(500).json({ success: false, error: 'Failed to delete predictions' });
    }
  }

  // ─── PATCH: Update scientific collection fields ────────────────────────────
  // Used by enhanceWithAI to add AI traceability to an existing prediction
  // Immutability trigger allows NULL → value (only blocks non-NULL → different value)
  if (req.method === 'PATCH') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }

    // Require prediction_id (UUID) and at least one scientific field
    const predictionId = String(body.prediction_id || '').trim();
    if (!predictionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(predictionId)) {
      return res.status(400).json({ success: false, error: 'Valid prediction_id (UUID) required' });
    }

    // Auth: user or device
    const userId = await requireUserAuth(req);
    let authedDeviceId = null;

    // DIAGNOSTIC: Log ai_response_hash value from PATCH body
    console.log(`[predictions PATCH] prediction_id=${predictionId}, ai_response_hash=${body.ai_response_hash || 'NULL'}, has_snapshot=${!!body.feature_snapshot}, field_count=${Object.keys(body).filter(k => k !== 'prediction_id').length}`);
    if (!userId) {
      authedDeviceId = await requireAuth(req);
      if (!authedDeviceId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }
    }

    try {
      const sql = createSql();

      // Phase 6 fix (forensic audit): PATCH must enforce NULL → value ONLY.
      // Fetch the existing row first so we can verify each field is NULL
      // before allowing an UPDATE. If the field already has a value,
      // reject the patch with a clear error. This is the application-level
      // enforcement; the DB trigger (migration 010) is the safety net but
      // would silently restore the old value, which is not acceptable UX.
      const ownershipFilter = userId
        ? sql`AND user_id = ${userId}`
        : sql`AND device_id = ${authedDeviceId}`;
      const existing = await sql`
        SELECT
          feature_snapshot, feature_snapshot_hash,
          model_version, feature_version, config_version,
          calibration_version, dataset_version,
          ai_context_hash, ai_input_hash, ai_prompt_hash, ai_response_hash,
          ai_prompt_version, ai_model, ai_trace,
          completeness_score, temporal_safety_score,
          temporal_safety_reason, timestamp_provenance, ai_provenance_risk,
          scientific_collection_eligible, version_freeze,
          provenance_status, t_feature, t_prediction
        FROM predictions
        WHERE id = ${predictionId}::uuid
        ${ownershipFilter}
      `;
      if (existing.length === 0) {
        await sql.end();
        return res.status(404).json({ success: false, error: 'Prediction not found or not owned' });
      }
      const current = existing[0];

      // Helper: returns true if the current DB value is non-NULL.
      const isSet = (v) => v !== null && v !== undefined;

      // Collect attempted illegal updates to return as a structured error
      const blockedUpdates = [];
      // Collect allowed updates (NULL → value)
      const updates = [];
      const params = [];

      // Helper to check and either queue an update or record a violation
      const tryUpdate = (fieldName, newValue) => {
        if (newValue === undefined || newValue === null) return; // no value supplied
        if (isSet(current[fieldName])) {
          // Existing value present — PATCH cannot change it
          blockedUpdates.push({
            field: fieldName,
            reason: 'FIELD_ALREADY_SET — only NULL → value is allowed (initial enrichment)',
          });
          return;
        }
        // Field is currently NULL → enqueue update
        updates.push(`${fieldName} = $${params.length + 1}`);
        params.push(newValue);
      };

      // Feature snapshot (JSONB)
      if (body.feature_snapshot && typeof body.feature_snapshot === 'object') {
        tryUpdate('feature_snapshot', sql.json(body.feature_snapshot));
      }
      if (body.feature_snapshot_hash) {
        tryUpdate('feature_snapshot_hash', String(body.feature_snapshot_hash).substring(0, 80));
      }
      // Model versions
      tryUpdate('model_version', body.model_version ? String(body.model_version).substring(0, 20) : undefined);
      tryUpdate('feature_version', body.feature_version ? String(body.feature_version).substring(0, 20) : undefined);
      tryUpdate('config_version', body.config_version ? String(body.config_version).substring(0, 20) : undefined);
      tryUpdate('calibration_version', body.calibration_version ? String(body.calibration_version).substring(0, 20) : undefined);
      tryUpdate('dataset_version', body.dataset_version ? String(body.dataset_version).substring(0, 20) : undefined);
      // AI hashes
      tryUpdate('ai_context_hash', body.ai_context_hash ? String(body.ai_context_hash).substring(0, 80) : undefined);
      tryUpdate('ai_input_hash', body.ai_input_hash ? String(body.ai_input_hash).substring(0, 80) : undefined);
      tryUpdate('ai_prompt_hash', body.ai_prompt_hash ? String(body.ai_prompt_hash).substring(0, 80) : undefined);
      tryUpdate('ai_response_hash', body.ai_response_hash ? String(body.ai_response_hash).substring(0, 80) : undefined);
      tryUpdate('ai_prompt_version', body.ai_prompt_version ? String(body.ai_prompt_version).substring(0, 20) : undefined);
      tryUpdate('ai_model', body.ai_model ? String(body.ai_model).substring(0, 50) : undefined);
      // AI trace (JSONB)
      if (body.ai_trace && typeof body.ai_trace === 'object') {
        tryUpdate('ai_trace', sql.json(body.ai_trace));
      }
      // Scores
      if (typeof body.completeness_score === 'number') {
        tryUpdate('completeness_score', Math.min(Math.max(body.completeness_score, 0), 1));
      }
      if (typeof body.temporal_safety_score === 'number') {
        tryUpdate('temporal_safety_score', Math.min(Math.max(body.temporal_safety_score, 0), 1));
      }
      // Phase 5.3.3: temporal_safety_reason and timestamp_provenance
      tryUpdate('temporal_safety_reason', body.temporal_safety_reason ? String(body.temporal_safety_reason).substring(0, 30) : undefined);
      if (body.timestamp_provenance && typeof body.timestamp_provenance === 'object') {
        tryUpdate('timestamp_provenance', sql.json(body.timestamp_provenance));
      }
      tryUpdate('ai_provenance_risk', body.ai_provenance_risk ? String(body.ai_provenance_risk).substring(0, 30) : undefined);
      // Scientific eligibility
      if (typeof body.scientific_collection_eligible === 'boolean') {
        tryUpdate('scientific_collection_eligible', body.scientific_collection_eligible);
      }
      // Version freeze (JSONB)
      if (body.version_freeze && typeof body.version_freeze === 'object') {
        tryUpdate('version_freeze', sql.json(body.version_freeze));
      }
      // Provenance status — special: only downgrade-blocked (DB handles this).
      // We allow NULL → value and any value → value (DB will block illegal downgrades).
      if (body.provenance_status) {
        // No immutability check on provenance_status at API level — DB trigger
        // decides what's a legal transition (migration 010 helper ranks the
        // enum and blocks true downgrades). We just enqueue.
        updates.push('provenance_status = $' + (params.length + 1));
        params.push(String(body.provenance_status).substring(0, 30));
      }
      // Temporal timestamps — strict NULL → value only
      if (body.t_feature != null) {
        // Reject client-supplied t_feature that equals current snapshot timestamp
        // (would be a fabrication attempt). The DB trigger will also block this.
        tryUpdate('t_feature', body.t_feature);
      }

      // If all attempted updates are illegal, return structured error
      if (updates.length === 0) {
        await sql.end();
        return res.status(409).json({
          success: false,
          error: 'All attempted updates are blocked by immutability rules (field already set)',
          blocked_updates: blockedUpdates,
        });
      }

      // If some updates are blocked but some are allowed, proceed with allowed
      // ones and surface the blocked list in the response.
      if (blockedUpdates.length > 0) {
        console.log(`[predictions PATCH] ${blockedUpdates.length} illegal update(s) blocked for prediction ${predictionId}: ${blockedUpdates.map(b => b.field).join(', ')}`);
      }

      // Add prediction_id as last param
      const idParam = '$' + (params.length + 1);
      params.push(predictionId);

      // Add ownership filter
      if (userId) {
        params.push(userId);
        const userParam = '$' + params.length;
        const query = `UPDATE predictions SET ${updates.join(', ')} WHERE id = ${idParam}::uuid AND user_id = ${userParam} RETURNING *`;
        const result = await sql.unsafe(query, params);
        await sql.end();
        if (result.length === 0) {
          return res.status(404).json({ success: false, error: 'Prediction not found or not owned' });
        }
        return res.status(200).json({ success: true, prediction: mapToCamelCase(result[0]) });
      } else {
        params.push(authedDeviceId);
        const deviceParam = '$' + params.length;
        const query = `UPDATE predictions SET ${updates.join(', ')} WHERE id = ${idParam}::uuid AND device_id = ${deviceParam} RETURNING *`;
        const result = await sql.unsafe(query, params);
        await sql.end();
        if (result.length === 0) {
          return res.status(404).json({ success: false, error: 'Prediction not found or not owned' });
        }
        return res.status(200).json({ success: true, prediction: mapToCamelCase(result[0]) });
      }
    } catch (err) {
      console.error('[predictions PATCH] Error:', err.message);
      return res.status(500).json({ success: false, error: 'Failed to update prediction' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
