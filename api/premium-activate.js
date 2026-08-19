// Vercel Serverless Function — Premium Activation (Server-side)
// Replaces direct Neon UPDATE from frontend (validateCode in storage.ts)
// Uses PostgreSQL transaction to prevent race conditions on code activation

import postgres from 'postgres';
import { setCorsHeaders, isOriginAllowed } from './_lib/cors.js';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

const DEVICE_ID_RE = /^dev-[a-z0-9]{8,}$/;

// ── Simple in-memory rate limiter (per device_id, survives within same warm instance) ──
const activateAttempts = new Map();
const MAX_ATTEMPTS_PER_HOUR = 15;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(deviceId) {
  const now = Date.now();
  const entry = activateAttempts.get(deviceId);
  if (!entry || now - entry.firstAttempt > ATTEMPT_WINDOW_MS) {
    activateAttempts.set(deviceId, { count: 1, firstAttempt: now });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS_PER_HOUR) {
    return false;
  }
  entry.count++;
  return true;
}

// Note: In-memory rate limiter added (per device_id, 15/hour).
// For production, migrate to Upstash Redis for cross-instance persistence.

export default async function handler(req, res) {
  // CORS (supports both GET and POST)
  setCorsHeaders(req, res, 'POST, GET, OPTIONS', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (!NEON_DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  // ─── GET: Check premium status ─────────────────────────────────────────────
  if (req.method === 'GET') {
    const deviceId = req.query.device_id || '';
    if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
      return res.status(400).json({ success: false, error: 'Valid device_id query parameter is required' });
    }

    try {
      const sql = postgres(NEON_DATABASE_URL);
      const [result] = await sql`
        SELECT check_premium_status(${deviceId}::text) as is_premium,
               (SELECT expires_at FROM premium_activations WHERE device_id = ${deviceId}) as expires_at
      `;
      await sql.end();
      const isPremium = result?.is_premium === true;
      return res.status(200).json({
        premium: isPremium,
        expires_at: isPremium ? (result?.expires_at || null) : null,
      });
    } catch (err) {
      console.error('[premium-activate GET] Error:', err.message);
      return res.status(500).json({ premium: false, error: 'Failed to check premium status' });
    }
  }

  // ─── POST: Activate premium code ────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  // Body size limit (10KB)
  const bodyStr = JSON.stringify(body);
  if (bodyStr.length > 10240) {
    return res.status(413).json({ success: false, error: 'Request body too large' });
  }

  const code = String(body.code || '').trim();
  const deviceId = String(body.device_id || '').trim();

  // Validate code: 4-50 characters
  if (!code || code.length < 4 || code.length > 50) {
    return res.status(400).json({ success: false, error: 'Invalid code' });
  }

  // Validate deviceId format (min 8 chars — harder to guess)
  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    return res.status(400).json({ success: false, error: 'Invalid device_id format' });
  }

  // Rate limit: max 15 activation attempts per device per hour
  if (!checkRateLimit(deviceId)) {
    return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
  }

  try {
    const sql = postgres(NEON_DATABASE_URL);

    // Use transaction to prevent race conditions (double activation)
    const result = await sql.begin(async (tx) => {
      // 1. Find the code with row-level lock (FOR UPDATE prevents concurrent reads)
      const [codeRow] = await tx`
        SELECT id, code, duration_days, used, used_at, used_by_device
        FROM access_codes
        WHERE code = ${code}
        FOR UPDATE
      `;

      if (!codeRow) {
        return { success: false, error: 'Code not found' };
      }

      // ── Reactivation: code already used by SAME device → restore access ──
      if (codeRow.used && codeRow.used_by_device === deviceId) {
        // Check if there's still a valid activation for this device
        const [existing] = await tx`
          SELECT expires_at FROM premium_activations
          WHERE device_id = ${deviceId}
          ORDER BY activated_at DESC LIMIT 1
        `;

        if (existing && new Date(existing.expires_at) > new Date()) {
          // Activation still valid → just return it (no reset)
          return {
            success: true,
            duration_days: codeRow.duration_days || 30,
            activated_at: new Date().toISOString(),
            expires_at: existing.expires_at,
            reactivated: true,
          };
        }

        // Activation expired or missing → reactivate (reset duration)
        const durationDays = codeRow.duration_days || 30;
        const [activation] = await tx`
          INSERT INTO premium_activations (device_id, activated_at, expires_at)
          VALUES (${deviceId}, NOW(), NOW() + INTERVAL '1 day' * ${durationDays})
          ON CONFLICT (device_id) DO UPDATE
            SET activated_at = NOW(), expires_at = NOW() + INTERVAL '1 day' * ${durationDays}
          RETURNING expires_at
        `;
        return {
          success: true,
          duration_days: durationDays,
          activated_at: new Date().toISOString(),
          expires_at: activation?.expires_at || null,
          reactivated: true,
        };
      }

      if (codeRow.used) {
        return { success: false, error: 'Code already used' };
      }

      // 2. First activation: mark as used (atomic — the FOR UPDATE lock guarantees exclusivity)
      const [updated] = await tx`
        UPDATE access_codes
        SET used = true, used_at = NOW(), used_by_device = ${deviceId}
        WHERE id = ${codeRow.id} AND used = false
        RETURNING id
      `;

      if (!updated) {
        return { success: false, error: 'Code already activated' };
      }

      // 3. Upsert premium activation with correct expiration
      const durationDays = codeRow.duration_days || 30;
      const [activation] = await tx`
        INSERT INTO premium_activations (device_id, activated_at, expires_at)
        VALUES (${deviceId}, NOW(), NOW() + INTERVAL '1 day' * ${durationDays})
        ON CONFLICT (device_id) DO UPDATE
          SET activated_at = NOW(), expires_at = NOW() + INTERVAL '1 day' * ${durationDays}
        RETURNING expires_at
      `;

      return {
        success: true,
        duration_days: durationDays,
        activated_at: new Date().toISOString(),
        expires_at: activation?.expires_at || null,
      };
    });

    await sql.end();

    if (result.success) {
      return res.status(200).json({
        success: true,
        valid: true,
        days: result.duration_days,
        expires_at: result.expires_at,
        reactivated: result.reactivated || false,
        message: result.reactivated
          ? `Premium restauré pour ${result.duration_days} jours`
          : `Premium activated for ${result.duration_days} days`,
      });
    } else {
      return res.status(400).json({
        success: false,
        valid: false,
        days: 0,
        error: result.error,
      });
    }
  } catch (err) {
    console.error('[premium-activate POST] Error:', err.message);
    return res.status(500).json({ success: false, valid: false, days: 0, error: 'Server error' });
  }
}
