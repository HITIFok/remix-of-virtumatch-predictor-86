// Vercel Serverless Function — Verify Magic Link
// Consumes the one-time token from the email link.
// On success: creates/finds user, finalizes premium if purpose='activate', issues session token.
// GET: token from query string (user clicks email link)
// POST: token from body (alternative for in-app handling)

import crypto from 'crypto';
import { setCorsHeaders } from '../_lib/cors.js';
import { createSql } from '../_lib/db.js';
import { signUserToken } from '../_lib/auth.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, POST, OPTIONS', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end('');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // ── Extract token (query for GET, body for POST) ──
  let token;
  if (req.method === 'GET') {
    token = String(req.query?.token || '').trim();
  } else {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      token = String(body.token || '').trim();
    } catch {
      return res.status(400).json({ success: false, error: 'JSON invalide' });
    }
  }

  if (!token || token.length < 16) {
    return res.status(400).json({ success: false, error: 'Token manquant ou invalide' });
  }

  // ── Hash the token to look up in DB (never log or return the plaintext token) ──
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const sql = createSql();
  try {
    // ── Find valid, unused magic link ──
    const [link] = await sql`
      SELECT id, email, purpose, payload, expires_at
      FROM magic_links
      WHERE token_hash = ${tokenHash}
        AND used_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!link) {
      await sql.end();
      return res.status(400).json({
        success: false,
        error: 'Lien invalide, expiré ou déjà utilisé.',
      });
    }

    // ── Mark as used IMMEDIATELY (single-use, prevents replay) ──
    await sql`
      UPDATE magic_links
      SET used_at = NOW()
      WHERE id = ${link.id} AND used_at IS NULL
    `;

    // ── Find or create user by email ──
    const [upserted] = await sql`
      INSERT INTO users (email)
      VALUES (${link.email})
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `;

    let userId = upserted?.id;
    if (!userId) {
      const [existing] = await sql`SELECT id FROM users WHERE email = ${link.email}`;
      userId = existing?.id;
    }

    if (!userId) {
      await sql.end();
      return res.status(500).json({ success: false, error: 'Erreur lors de la création du compte' });
    }

    // ── If purpose='activate': finalize premium activation ──
    let premiumResult = null;

    if (link.purpose === 'activate' && link.payload) {
      const { code, durationDays } = link.payload;

      premiumResult = await sql.begin(async (tx) => {
        // 1. Lock the code row (FOR UPDATE prevents concurrent activation)
        const [codeRow] = await tx`
          SELECT id, code, duration_days, used, used_at, used_by_device
          FROM access_codes
          WHERE code = ${code}
          FOR UPDATE
        `;

        if (!codeRow) return { success: false, error: 'Code non trouvé' };

        // 2. Reactivation: same user, same code, premium expired → re-activate
        if (codeRow.used && codeRow.used_by_device === userId) {
          const [existing] = await tx`
            SELECT expires_at FROM premium_activations
            WHERE user_id = ${userId}
            ORDER BY activated_at DESC LIMIT 1
          `;

          if (!existing || new Date(existing.expires_at) <= new Date()) {
            // Premium expired or missing → re-activate
            const days = durationDays || codeRow.duration_days || 30;
            const [activation] = await tx`
              INSERT INTO premium_activations (user_id, activated_at, expires_at)
              VALUES (${userId}, NOW(), NOW() + INTERVAL '1 day' * ${days})
              RETURNING expires_at
            `;
            return {
              success: true,
              duration_days: days,
              expires_at: activation?.expires_at || null,
              reactivated: true,
            };
          }
          // Premium still valid → no-op
          return {
            success: true,
            duration_days: codeRow.duration_days || 30,
            expires_at: existing.expires_at,
            reactivated: true,
          };
        }

        if (codeRow.used) {
          return { success: false, error: 'Code déjà utilisé' };
        }

        // 3. First activation: mark code as used atomically
        const [updated] = await tx`
          UPDATE access_codes
          SET used = true, used_at = NOW(), used_by_device = ${userId}
          WHERE id = ${codeRow.id} AND used = false
          RETURNING id
        `;

        if (!updated) {
          return { success: false, error: 'Code déjà activé' };
        }

        // 4. Create premium activation
        const days = durationDays || codeRow.duration_days || 30;
        const [activation] = await tx`
          INSERT INTO premium_activations (user_id, activated_at, expires_at)
          VALUES (${userId}, NOW(), NOW() + INTERVAL '1 day' * ${days})
          RETURNING expires_at
        `;

        return {
          success: true,
          duration_days: days,
          expires_at: activation?.expires_at || null,
        };
      });

      if (!premiumResult.success) {
        await sql.end();
        return res.status(400).json({
          success: false,
          error: premiumResult.error,
        });
      }
    }

    // ── Issue session token (HMAC-SHA256, 30-day expiry) ──
    const sessionToken = signUserToken(userId);

    await sql.end();

    return res.status(200).json({
      success: true,
      token: sessionToken,
      expiresIn: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
      email: link.email,
      ...(premiumResult ? {
        premium: {
          activated: true,
          days: premiumResult.duration_days,
          expires_at: premiumResult.expires_at,
          reactivated: premiumResult.reactivated || false,
        },
      } : {}),
    });
  } catch (err) {
    console.error('[auth/verify] Error:', err.message);
    try { await sql.end(); } catch { /* */ }
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
}
