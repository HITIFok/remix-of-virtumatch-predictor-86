// Vercel Serverless Function — Admin Codes + Delete + Migrate (ESM)
// Unified handler for access code management and device migration.
//
// Routes (all require Bearer admin token):
//   GET  (no action)        → List all access codes
//   GET  ?action=migrate    → List all device_ids with prediction counts
//   POST (body has codeId)  → Delete an access code
//   POST (body has from_device_id) → Migrate predictions from one device to another
//   POST (body has code)    → Create a new access code

import crypto from 'crypto';
import postgres from 'postgres';
import { setCorsHeaders } from './_lib/cors.js';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

const sql = postgres(NEON_DATABASE_URL);

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
  return req.query?.token || '';
}

function parseBody(req) {
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  if (typeof req.body === 'string' && req.body.length > 0) {
    try { Object.assign(body, JSON.parse(req.body)); } catch { /* ignore */ }
  }
  return body;
}

// ═══════════════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════════════

async function handleGet(req, res, action) {
  if (action === 'migrate') {
    // List all device_ids with prediction counts
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
  // Route by body content

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
    const migratePremium = body.migrate_premium !== false; // default: true

    if (!toDeviceId) {
      return res.status(400).json({ success: false, error: 'from_device_id and to_device_id are required' });
    }
    if (fromDeviceId === toDeviceId) {
      return res.status(400).json({ success: false, error: 'from_device_id and to_device_id must be different' });
    }

    // Check that source device has predictions
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

      // 1. Count predictions to migrate
      const [countRow] = await tx`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'correct') as correct,
          COUNT(*) FILTER (WHERE status = 'incorrect') as incorrect
        FROM predictions WHERE device_id = ${fromDeviceId}
      `;
      stats.from = countRow;

      // 2. Handle conflicts
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

      // 3. Migrate non-conflicting predictions
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

      // 4. Migrate premium activation
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

      // 5. Update access_codes used_by_device
      await tx`
        UPDATE access_codes
        SET used_by_device = ${toDeviceId}
        WHERE used_by_device = ${fromDeviceId}
      `;
      stats.codes_updated = true;

      // 6. Clean up old premium activation
      if (stats.premium_migrated) {
        await tx`DELETE FROM premium_activations WHERE device_id = ${fromDeviceId}`;
      }

      // 7. Check remaining predictions on source
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
    return res.status(400).json({ success: false, error: 'Durée invalide (1-365 jours)' });
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

  if (!NEON_DATABASE_URL || !ADMIN_TOKEN_SECRET) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  // Auth
  const token = extractToken(req);
  if (!verifyToken(token).valid) {
    return res.status(401).json({ success: false, error: 'Session admin invalide ou expirée' });
  }

  try {
    if (req.method === 'GET') {
      return await handleGet(req, res, req.query?.action);
    }

    const body = parseBody(req);
    return await handlePost(req, res, body);
  } catch (err) {
    console.error('[admin-codes] Exception:', err.message);
    return res.status(200).json({ success: false, error: 'Erreur serveur' });
  }
}
