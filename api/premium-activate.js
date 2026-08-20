// Vercel Serverless Function — Premium Activation (Server-side)
// Uses PostgreSQL transaction to prevent race conditions on code activation.
//
// Phase 3: GET now tries user auth (requireUserAuth) first, falls back to
// device auth (requireAuth) for backward compat during transition.
// POST with email triggers magic link; without email keeps legacy direct activation.

import crypto from 'crypto';
import { Resend } from 'resend';
import postgres from 'postgres';
import { setCorsHeaders } from './_lib/cors.js';
import { requireAuth, requireUserAuth } from './_lib/auth.js';
import { createSql } from './_lib/db.js';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'VirtuMatch <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'https://virtual-match-hitifproject.vercel.app';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Rate limiting (in-memory, per identifier) ──
const activateAttempts = new Map();
const MAX_ATTEMPTS_PER_HOUR = 15;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(identifier) {
  const now = Date.now();
  const entry = activateAttempts.get(identifier);
  if (!entry || now - entry.firstAttempt > ATTEMPT_WINDOW_MS) {
    activateAttempts.set(identifier, { count: 1, firstAttempt: now });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS_PER_HOUR) return false;
  entry.count++;
  return true;
}

// ── Magic link helper (inlined — shared logic with api/auth.js) ──
async function sendActivationMagicLink(email, code, durationDays) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const sql = createSql();
  try {
    await sql`
      INSERT INTO magic_links (token_hash, email, purpose, payload, expires_at)
      VALUES (
        ${tokenHash},
        ${email},
        'activate',
        ${JSON.stringify({ code, durationDays })},
        NOW() + INTERVAL '15 minutes'
      )
    `;
    await sql.end();
  } catch (err) {
    console.error('[premium-activate] magic link DB error:', err.message);
    try { await sql.end(); } catch { /* */ }
    throw new Error('Erreur serveur');
  }

  const verifyUrl = `${APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;
  const html = `<div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;">
<h2 style="color:#6c5ce7;">VirtuMatch</h2>
<p>Clique sur le bouton ci-dessous pour activer ton code premium :</p>
<a href="${verifyUrl}" style="display:inline-block;background:#6c5ce7;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">Activer mon Premium</a>
<p style="color:#888;font-size:14px;">Ce lien expire dans 15 minutes. Si tu n'as pas fait cette demande, ignore cet email.</p>
</div>`;

  if (RESEND_API_KEY) {
    try {
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: RESEND_FROM,
        to: email,
        subject: 'Active ton accès Premium — VirtuMatch',
        html,
      });
    } catch (err) {
      console.error('[premium-activate] Resend error:', err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'POST, GET, OPTIONS', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end('');

  if (!NEON_DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  // ─── GET: Check premium status ─────────────────────────────────────────
  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  return handlePost(req, res);
}

// ─── GET handler ──────────────────────────────────────────────────────────

async function handleGet(req, res) {
  // Priority 1: user auth (email-based account)
  const userId = await requireUserAuth(req);

  if (userId) {
    try {
      const sql = postgres(NEON_DATABASE_URL);
      const [result] = await sql`
        SELECT expires_at FROM premium_activations
        WHERE user_id = ${userId} AND expires_at > NOW()
        ORDER BY expires_at DESC LIMIT 1
      `;
      await sql.end();
      const isPremium = !!result?.expires_at;
      return res.status(200).json({
        premium: isPremium,
        expires_at: isPremium ? result.expires_at : null,
      });
    } catch (err) {
      console.error('[premium-activate GET] Error:', err.message);
      return res.status(500).json({ premium: false, error: 'Failed to check premium status' });
    }
  }

  // Fallback: device auth (legacy — temporary, removed after Phase 5 migration)
  const deviceId = await requireAuth(req);
  if (!deviceId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
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

// ─── POST handler ─────────────────────────────────────────────────────────

async function handlePost(req, res) {
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  const bodyStr = JSON.stringify(body);
  if (bodyStr.length > 10240) {
    return res.status(413).json({ success: false, error: 'Request body too large' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();

  if (!code || code.length < 4 || code.length > 50) {
    return res.status(400).json({ success: false, error: 'Invalid code' });
  }

  // ── NEW FLOW: email provided → trigger magic link ──
  if (email && EMAIL_RE.test(email)) {
    if (!RESEND_API_KEY) {
      return res.status(500).json({ success: false, error: 'Service not configured' });
    }

    if (!checkRateLimit(email)) {
      return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
    }

    // Look up the code to validate it exists and get duration
    const sql = postgres(NEON_DATABASE_URL);
    try {
      const [codeRow] = await sql`
        SELECT id, duration_days, used, used_by_device
        FROM access_codes WHERE code = ${code}
      `;

      if (!codeRow) {
        await sql.end();
        return res.status(400).json({ success: false, error: 'Code non trouvé' });
      }

      // If used by a different user, reject early
      if (codeRow.used) {
        const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
        if (!user || codeRow.used_by_device !== user.id) {
          await sql.end();
          return res.status(400).json({ success: false, error: 'Code déjà utilisé' });
        }
      }

      const durationDays = codeRow.duration_days || 30;
      await sql.end();

      await sendActivationMagicLink(email, code, durationDays);

      return res.status(200).json({
        success: true,
        message: 'Si cet email est valide, un lien a été envoyé.',
      });
    } catch (err) {
      console.error('[premium-activate POST magic-link] Error:', err.message);
      try { await sql.end(); } catch { /* */ }
      return res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }

  // ── LEGACY FLOW: no email → direct activation by device_id ──
  // Kept for backward compat with existing frontend (removed after Phase 4)
  const authedDeviceId = await requireAuth(req);
  if (!authedDeviceId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  if (!checkRateLimit(authedDeviceId)) {
    return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
  }

  try {
    const sql = postgres(NEON_DATABASE_URL);

    const result = await sql.begin(async (tx) => {
      const [codeRow] = await tx`
        SELECT id, code, duration_days, used, used_at, used_by_device
        FROM access_codes WHERE code = ${code} FOR UPDATE
      `;

      if (!codeRow) return { success: false, error: 'Code not found' };

      if (codeRow.used && codeRow.used_by_device === authedDeviceId) {
        const [existing] = await tx`
          SELECT expires_at FROM premium_activations
          WHERE device_id = ${authedDeviceId}
          ORDER BY activated_at DESC LIMIT 1
        `;

        if (existing && new Date(existing.expires_at) > new Date()) {
          return {
            success: true, duration_days: codeRow.duration_days || 30,
            activated_at: new Date().toISOString(),
            expires_at: existing.expires_at, reactivated: true,
          };
        }

        const durationDays = codeRow.duration_days || 30;
        const [activation] = await tx`
          INSERT INTO premium_activations (device_id, activated_at, expires_at)
          VALUES (${authedDeviceId}, NOW(), NOW() + INTERVAL '1 day' * ${durationDays})
          ON CONFLICT (device_id) DO UPDATE
            SET activated_at = NOW(), expires_at = NOW() + INTERVAL '1 day' * ${durationDays}
          RETURNING expires_at
        `;
        return {
          success: true, duration_days: durationDays,
          activated_at: new Date().toISOString(),
          expires_at: activation?.expires_at || null, reactivated: true,
        };
      }

      if (codeRow.used) return { success: false, error: 'Code already used' };

      const [updated] = await tx`
        UPDATE access_codes
        SET used = true, used_at = NOW(), used_by_device = ${authedDeviceId}
        WHERE id = ${codeRow.id} AND used = false
        RETURNING id
      `;

      if (!updated) return { success: false, error: 'Code already activated' };

      const durationDays = codeRow.duration_days || 30;
      const [activation] = await tx`
        INSERT INTO premium_activations (device_id, activated_at, expires_at)
        VALUES (${authedDeviceId}, NOW(), NOW() + INTERVAL '1 day' * ${durationDays})
        ON CONFLICT (device_id) DO UPDATE
          SET activated_at = NOW(), expires_at = NOW() + INTERVAL '1 day' * ${durationDays}
        RETURNING expires_at
      `;

      return {
        success: true, duration_days: durationDays,
        activated_at: new Date().toISOString(),
        expires_at: activation?.expires_at || null,
      };
    });

    await sql.end();

    if (result.success) {
      return res.status(200).json({
        success: true, valid: true, days: result.duration_days,
        expires_at: result.expires_at,
        reactivated: result.reactivated || false,
        message: result.reactivated
          ? `Premium restauré pour ${result.duration_days} jours`
          : `Premium activated for ${result.duration_days} days`,
      });
    }
    return res.status(400).json({ success: false, valid: false, days: 0, error: result.error });
  } catch (err) {
    console.error('[premium-activate POST legacy] Error:', err.message);
    return res.status(500).json({ success: false, valid: false, days: 0, error: 'Server error' });
  }
}
