// Vercel Serverless Function — Admin Unified (ESM)
// Merged admin-login + admin-codes into single function (Vercel Hobby 12-function limit).
//
// Routes:
//   POST ?action=login    → Admin login (body: { password }) — rate limited
//   POST ?action=verify   → Verify admin token (body: { token })
//   GET  (no action)      → List all access codes (requires Bearer admin token)
//   GET  ?action=migrate  → List device_ids with prediction counts (requires Bearer admin token)
//   POST (body has codeId)       → Delete an access code (requires Bearer admin token)
//   POST (body has from_device_id) → Migrate predictions (requires Bearer admin token)
//   POST (body has code)          → Create a new access code (requires Bearer admin token)

import crypto from 'crypto';
import postgres from 'postgres';
import { setCorsHeaders, isOriginAllowed } from './_lib/cors.js';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

const sql = postgres(NEON_DATABASE_URL);

// ─── Rate Limiting (in-memory, per instance serverless) ───────────────────────
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const attempts = new Map(); // IP → { count, firstAttempt }

function checkRateLimit(ip) {
  const now = Date.now();
  const record = attempts.get(ip);

  if (!record || now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX_ATTEMPTS - 1 };
  }

  if (record.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((record.firstAttempt + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  record.count++;
  const remaining = RATE_LIMIT_MAX_ATTEMPTS - record.count;
  return { allowed: true, remaining };
}

// ─── Token HMAC ──────────────────────────────────────────────────────────────

function signToken(timestamp) {
  const payload = Buffer.from(String(timestamp)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', ADMIN_TOKEN_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return { valid: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false };
  const [payload, signature] = parts;

  let timestamp;
  try {
    timestamp = parseInt(Buffer.from(payload, 'base64url').toString(), 10);
  } catch { return { valid: false }; }
  if (isNaN(timestamp)) return { valid: false };
  if (Date.now() - timestamp > SESSION_DURATION_MS) return { valid: false };

  const expected = crypto
    .createHmac('sha256', ADMIN_TOKEN_SECRET)
    .update(payload)
    .digest('base64url');

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return { valid: false };
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return { valid: false };
  } catch { return { valid: false }; }

  return { valid: true };
}

function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return '';
}

function parseBody(req) {
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  if (typeof req.body === 'string' && req.body.length > 0) {
    try { Object.assign(body, JSON.parse(req.body)); } catch { /* ignore */ }
  }
  return body;
}

// ═══════════════════════════════════════════════════════════════════
// Login handler — POST ?action=login
// ═══════════════════════════════════════════════════════════════════

async function handleLogin(req, res, body) {
  if (!NEON_DATABASE_URL) {
    console.error('[admin/login] NEON_DATABASE_URL manquant');
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  // Rate limiting
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rateLimit = checkRateLimit(clientIp);

  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.retryAfter));
    return res.status(429).json({
      success: false,
      error: `Trop de tentatives. Réessayez dans ${rateLimit.retryAfter} secondes.`,
    });
  }

  const { password } = body;
  if (!password || typeof password !== 'string' || password.length > 128) {
    return res.status(400).json({ success: false, error: 'Password manquant ou invalide' });
  }

  try {
    const [result] = await sql`SELECT verify_admin_password(${password}::text)`;
    const isValid = result?.verify_admin_password === true;

    if (!isValid) {
      return res.status(200).json({
        success: false,
        error: 'Mot de passe ou identifiants incorrects',
        remainingAttempts: rateLimit.remaining,
      });
    }

    const timestamp = Date.now();
    const token = signToken(timestamp);
    attempts.delete(clientIp);

    return res.status(200).json({
      success: true,
      token,
      expiresIn: SESSION_DURATION_MS,
    });
  } catch (err) {
    console.error('[admin/login] Exception:', err.message);
    return res.status(200).json({ success: false, error: 'Erreur serveur' });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Verify handler — POST ?action=verify
// ═══════════════════════════════════════════════════════════════════

function handleVerify(req, res, body) {
  const result = verifyToken(body.token);
  return res.status(200).json({ valid: result.valid });
}

// ═══════════════════════════════════════════════════════════════════
// Code management handlers (require Bearer admin token)
// ═══════════════════════════════════════════════════════════════════

async function handleGet(req, res, action) {
  if (action === 'migrate') {
    const devices = await sql`
      SELECT
        device_id,
        COUNT(*) as total_predictions,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'correct') as correct,
        COUNT(*) FILTER (WHERE status = 'incorrect') as incorrect,
        MIN(created_at) as first_prediction,
        MAX(created_at) as last_prediction
      FROM predictions
      GROUP BY device_id
      ORDER BY last_prediction DESC
    `;

    const activations = await sql`
      SELECT device_id, activated_at, expires_at
      FROM premium_activations
      ORDER BY activated_at DESC
    `;

    return res.status(200).json({
      success: true,
      devices,
      activations,
      total_devices: devices.length,
    });
  }

  // Default: list all access codes
  const data = await sql`SELECT * FROM access_codes ORDER BY created_at DESC`;
  return res.status(200).json({
    success: true,
    codes: data.map(row => ({
      id: row.id,
      code: row.code,
      createdAt: new Date(row.created_at).getTime(),
      durationDays: row.duration_days,
      used: row.used,
      usedAt: row.used_at ? new Date(row.used_at).getTime() : null,
      usedByDevice: row.used_by_device || null,
    })),
  });
}

async function handlePost(req, res, body) {
  // ── Delete code (body has codeId) ──
  if (body.codeId) {
    const { codeId } = body;
    if (typeof codeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(codeId)) {
      return res.status(400).json({ success: false, error: 'codeId invalide' });
    }
    const [result] = await sql`SELECT admin_delete_access_code(${codeId}::uuid)`;
    return res.status(200).json({ success: result?.admin_delete_access_code === true });
  }

  // ── Migrate predictions (body has from_device_id) ──
  if (body.from_device_id) {
    const fromDeviceId = String(body.from_device_id || '').trim();
    const toDeviceId = String(body.to_device_id || '').trim();
    const migratePremium = body.migrate_premium !== false;

    if (!toDeviceId) {
      return res.status(400).json({ success: false, error: 'from_device_id and to_device_id are required' });
    }
    if (fromDeviceId === toDeviceId) {
      return res.status(400).json({ success: false, error: 'from_device_id and to_device_id must be different' });
    }

    const [sourceInfo] = await sql`
      SELECT COUNT(*) as count FROM predictions WHERE device_id = ${fromDeviceId}
    `;
    if (!sourceInfo || sourceInfo.count === 0) {
      return res.status(404).json({
        success: false,
        error: `No predictions found for device_id: ${fromDeviceId}`,
      });
    }

    const result = await sql.begin(async (tx) => {
      const stats = {};

      const [countRow] = await tx`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'correct') as correct,
          COUNT(*) FILTER (WHERE status = 'incorrect') as incorrect
        FROM predictions WHERE device_id = ${fromDeviceId}
      `;
      stats.from = countRow;

      const conflicts = await tx`
        SELECT COUNT(*) as count FROM predictions p1
        WHERE p1.device_id = ${fromDeviceId}
        AND EXISTS (
          SELECT 1 FROM predictions p2
          WHERE p2.device_id = ${toDeviceId}
          AND p2.home_team = p1.home_team
          AND p2.away_team = p1.away_team
          AND p2.league = p1.league
        )
      `;
      stats.conflicts = conflicts[0]?.count || 0;

      const migrated = await tx`
        UPDATE predictions
        SET device_id = ${toDeviceId}
        WHERE device_id = ${fromDeviceId}
        AND NOT EXISTS (
          SELECT 1 FROM predictions p2
          WHERE p2.device_id = ${toDeviceId}
          AND p2.home_team = predictions.home_team
          AND p2.away_team = predictions.away_team
          AND p2.league = predictions.league
        )
        RETURNING id
      `;
      stats.migrated = migrated.length;

      stats.premium_migrated = false;
      if (migratePremium) {
        const [premiumRow] = await tx`
          SELECT activated_at, expires_at FROM premium_activations
          WHERE device_id = ${fromDeviceId}
        `;

        if (premiumRow) {
          const [targetPremium] = await tx`
            SELECT expires_at FROM premium_activations WHERE device_id = ${toDeviceId}
          `;

          if (targetPremium) {
            const fromExpiry = new Date(premiumRow.expires_at);
            const toExpiry = new Date(targetPremium.expires_at);
            if (fromExpiry > toExpiry) {
              await tx`
                UPDATE premium_activations
                SET activated_at = ${premiumRow.activated_at}, expires_at = ${premiumRow.expires_at}
                WHERE device_id = ${toDeviceId}
              `;
              stats.premium_migrated = true;
              stats.premium_action = 'extended';
            } else {
              stats.premium_action = 'kept_existing';
            }
          } else {
            await tx`
              INSERT INTO premium_activations (device_id, activated_at, expires_at)
              VALUES (${toDeviceId}, ${premiumRow.activated_at}, ${premiumRow.expires_at})
              ON CONFLICT (device_id) DO UPDATE
                SET activated_at = ${premiumRow.activated_at}, expires_at = ${premiumRow.expires_at}
            `;
            stats.premium_migrated = true;
            stats.premium_action = 'migrated';
          }
        }
      }

      await tx`
        UPDATE access_codes
        SET used_by_device = ${toDeviceId}
        WHERE used_by_device = ${fromDeviceId}
      `;
      stats.codes_updated = true;

      if (stats.premium_migrated) {
        await tx`DELETE FROM premium_activations WHERE device_id = ${fromDeviceId}`;
      }

      const [remaining] = await tx`
        SELECT COUNT(*) as count FROM predictions WHERE device_id = ${fromDeviceId}
      `;
      stats.remaining_on_source = remaining?.count || 0;

      return stats;
    });

    return res.status(200).json({
      success: true,
      message: `Migrated ${result.migrated} predictions from ${fromDeviceId} to ${toDeviceId}`,
      result,
    });
  }

  // ── Create code (body has code + durationDays) ──
  const { code, durationDays } = body;
  if (!code || typeof code !== 'string' || code.length < 4 || code.length > 30) {
    return res.status(400).json({ success: false, error: 'Code invalide' });
  }
  if (!durationDays || typeof durationDays !== 'number' || durationDays < 1 || durationDays > 365) {
    return res.status(400).json({ success: false, error: 'Durée invalide (1-365 jour)' });
  }

  const data = await sql`
    INSERT INTO access_codes (code, duration_days, used)
    VALUES (${code}, ${durationDays}, false)
    RETURNING *
  `;

  if (!data || data.length === 0) {
    return res.status(200).json({ success: false, error: 'Erreur lors de l\'insertion' });
  }

  return res.status(200).json({ success: true, code: data[0].code });
}

// ═══════════════════════════════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!ADMIN_TOKEN_SECRET) {
    console.error('[admin] ADMIN_TOKEN_SECRET manquant');
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  const action = String(req.query?.action || '').trim();
  const body = parseBody(req);

  // ── Login & Verify: no Bearer token required ──
  if (req.method === 'POST' && action === 'login') {
    // Block unauthorized origins
    const origin = req.headers.origin || '';
    const isSameHost = req.headers.host?.includes('vercel.app') || req.headers.host?.includes('localhost');
    const isAllowed = isOriginAllowed(origin, req.headers.host || '') || (!origin && isSameHost);
    if (!isAllowed) {
      return res.status(403).json({ success: false, error: 'Origin non autorisé' });
    }
    return await handleLogin(req, res, body);
  }

  if (req.method === 'POST' && action === 'verify') {
    return handleVerify(req, res, body);
  }

  // ── All other routes require Bearer admin token ──
  if (!NEON_DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  const token = extractToken(req);
  if (!verifyToken(token).valid) {
    return res.status(401).json({ success: false, error: 'Session admin invalide ou expirée' });
  }

  try {
    if (req.method === 'GET') {
      return await handleGet(req, res, action);
    }

    return await handlePost(req, res, body);
  } catch (err) {
    console.error('[admin] Exception:', err.message);
    return res.status(200).json({ success: false, error: 'Erreur serveur' });
  }
}
