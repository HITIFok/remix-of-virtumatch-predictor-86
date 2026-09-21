// Vercel Serverless Function — Admin Migrate Predictions (ESM)
// Migrates predictions (and premium activation) from one device_id to another.
// Useful when a user's device_id changed due to localStorage clearing.
//
// Auth: Requires admin token (same as admin-codes)
// Methods:
//   GET  — List all device_ids with prediction counts (helps identify old vs new)
//   POST — Migrate predictions + premium from old_device_id to new_device_id
//
// Usage:
//   GET  /api/admin-migrate?token=xxx
//   POST /api/admin-migrate  body: { from_device_id, to_device_id, token, migrate_premium }

import crypto from 'crypto';
import postgres from 'postgres';
import { setCorsHeaders } from './_lib/cors.js';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

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

  const expectedSig = crypto
    .createHmac('sha256', ADMIN_TOKEN_SECRET)
    .update(payload)
    .digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return { valid: false };
  }

  return { valid: true, timestamp };
}

function extractToken(req) {
  // From Authorization header
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);

  // From query param (for GET requests)
  return req.query.token || '';
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, POST, OPTIONS', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // ── Auth ──
  const token = extractToken(req);
  const auth = verifyToken(token);
  if (!auth.valid) {
    return res.status(401).json({ success: false, error: 'Unauthorized — invalid or expired admin token' });
  }

  if (!NEON_DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  const sql = postgres(NEON_DATABASE_URL);

  try {
    // ═══════════════════════════════════════════════════════════════════
    // GET: List all device_ids with prediction counts
    // ═══════════════════════════════════════════════════════════════════
    if (req.method === 'GET') {
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

      // Also list premium activations
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

    // ═══════════════════════════════════════════════════════════════════
    // POST: Migrate predictions from one device_id to another
    // ═══════════════════════════════════════════════════════════════════
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }

    const fromDeviceId = String(body.from_device_id || '').trim();
    const toDeviceId = String(body.to_device_id || '').trim();
    const migratePremium = body.migrate_premium !== false; // default: true

    if (!fromDeviceId || !toDeviceId) {
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

    // Check that target device exists
    const [targetInfo] = await sql`
      SELECT COUNT(*) as count FROM predictions WHERE device_id = ${toDeviceId}
    `;

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

      // 2. Handle conflicts: check for duplicate (home_team, away_team, created_at)
      // Predictions that already exist in target are skipped
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

      // 4. Migrate premium activation (if requested)
      stats.premium_migrated = false;
      if (migratePremium) {
        const [premiumRow] = await tx`
          SELECT activated_at, expires_at FROM premium_activations
          WHERE device_id = ${fromDeviceId}
        `;

        if (premiumRow) {
          // Check if target already has premium
          const [targetPremium] = await tx`
            SELECT expires_at FROM premium_activations WHERE device_id = ${toDeviceId}
          `;

          if (targetPremium) {
            // Target has premium — keep the later expiry
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
              stats.premium_migrated = false;
              stats.premium_action = 'kept_existing';
            }
          } else {
            // Target has no premium — migrate
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

      // 5. Update access_codes used_by_device to new device_id
      await tx`
        UPDATE access_codes
        SET used_by_device = ${toDeviceId}
        WHERE used_by_device = ${fromDeviceId}
      `;
      stats.codes_updated = true;

      // 6. Clean up old premium activation (source)
      if (stats.premium_migrated) {
        await tx`
          DELETE FROM premium_activations WHERE device_id = ${fromDeviceId}
        `;
      }

      // 7. Check remaining predictions on source
      const [remaining] = await tx`
        SELECT COUNT(*) as count FROM predictions WHERE device_id = ${fromDeviceId}
      `;
      stats.remaining_on_source = remaining?.count || 0;

      return stats;
    });

    await sql.end();

    return res.status(200).json({
      success: true,
      message: `Migrated ${result.migrated} predictions from ${fromDeviceId} to ${toDeviceId}`,
      result,
    });

  } catch (err) {
    console.error('[admin-migrate] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
