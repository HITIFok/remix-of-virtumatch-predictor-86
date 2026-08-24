// Vercel Serverless Function — Magic Link Auth (unified)
// Routes (single function to stay within Vercel Hobby 12-function limit):
//   POST ?action=request  → Send magic link email (body: { email, purpose, code?, durationDays? })
//   GET  ?action=verify&token=xxx  → Verify magic link from email
//   POST ?action=verify         → Verify magic link from body { token }

import crypto from 'crypto';
import { setCorsHeaders } from './_lib/cors.js';
import { createSql } from './_lib/db.js';
import { signUserToken } from './_lib/auth.js';

// Lazy-load Resend to avoid import-time crash if package is missing
async function getResend() {
  try {
    const mod = await import('resend');
    return mod.Resend;
  } catch {
    return null;
  }
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'VirtuMatch <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'https://virtual-match-hitifproject.vercel.app';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Rate limiting: per email AND per IP (in-memory) ──
const attempts = new Map();
const MAX_PER_WINDOW = 3;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(email, ip) {
  const now = Date.now();
  const wKey = Math.floor(now / WINDOW_MS);

  const eKey = `e:${email.toLowerCase()}:${wKey}`;
  const iKey = `i:${ip}:${wKey}`;

  const eRec = attempts.get(eKey);
  if (eRec && eRec.c >= MAX_PER_WINDOW) return false;

  const iRec = attempts.get(iKey);
  if (iRec && iRec.c >= MAX_PER_WINDOW) return false;

  attempts.set(eKey, { c: (eRec ? eRec.c : 0) + 1, t: now });
  attempts.set(iKey, { c: (iRec ? iRec.c : 0) + 1, t: now });
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// REQUEST — POST ?action=request
// Sends a one-time magic link email via Resend.
// Response is IDENTICAL whether the email exists or not.
// ═══════════════════════════════════════════════════════════════════

async function handleRequest(req, res) {
  if (!RESEND_API_KEY) {
    console.error('[auth] RESEND_API_KEY not configured');
    return res.status(500).json({ success: false, error: 'Service not configured' });
  }

  // ── Parse body ──
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ success: false, error: 'JSON invalide' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const purpose = String(body.purpose || '').trim();

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, error: 'Email invalide' });
  }

  if (purpose !== 'activate' && purpose !== 'login' && purpose !== 'migrate') {
    return res.status(400).json({ success: false, error: "Purpose doit être 'activate', 'login' ou 'migrate'" });
  }

  // ── If purpose='activate', validate code + durationDays ──
  // ── If purpose='migrate', extract device_id from request ──
  let payload = null;
  if (purpose === 'activate') {
    const code = String(body.code || '').trim();
    const durationDays = parseInt(body.durationDays, 10);

    if (!code || code.length < 4 || code.length > 50) {
      return res.status(400).json({ success: false, error: 'Code invalide' });
    }
    if (isNaN(durationDays) || durationDays < 1 || durationDays > 365) {
      return res.status(400).json({ success: false, error: 'Durée invalide (1-365 jours)' });
    }
    payload = { code, durationDays };
  }

  if (purpose === 'migrate') {
    const deviceId = req.headers['x-device-id'] || String(body.device_id || '').trim();
    if (!deviceId || !/^dev-[a-z0-9]{8,}$/.test(deviceId)) {
      return res.status(400).json({ success: false, error: 'Appareil non reconnu' });
    }
    payload = { device_id: deviceId };
  }

  // ── Rate limit ──
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(email, ip)) {
    return res.status(429).json({
      success: false,
      error: 'Trop de demandes. Réessaie dans quelques minutes.',
    });
  }

  // ── Generate token (cryptographically secure) ──
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const sql = createSql();
  try {
    await sql`
      INSERT INTO magic_links (token_hash, email, purpose, payload, expires_at)
      VALUES (
        ${tokenHash},
        ${email},
        ${purpose},
        ${payload ? JSON.stringify(payload) : null},
        NOW() + INTERVAL '15 minutes'
      )
    `;
    await sql.end();
  } catch (err) {
    console.error('[auth/request] DB error:', err.message);
    try { await sql.end(); } catch { /* */ }
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }

  // ── Send email via Resend ──
  const verifyUrl = `${APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;
  const subject = purpose === 'activate'
    ? 'Active ton accès Premium — VirtuMatch'
    : purpose === 'migrate'
    ? 'Lie ton compte Premium — VirtuMatch'
    : 'Connexion à ton compte — VirtuMatch';
  const ctaText = purpose === 'activate'
    ? 'Activer mon Premium'
    : purpose === 'migrate'
    ? 'Lier mon compte'
    : 'Me connecter';
  const html = `<div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;">
<h2 style="color:#6c5ce7;">VirtuMatch</h2>
<p>Clique sur le bouton ci-dessous pour ${purpose === 'activate' ? 'activer ton code premium' : purpose === 'migrate' ? 'lier ton premium à ton email' : 'te connecter à ton compte'} :</p>
<a href="${verifyUrl}" style="display:inline-block;background:#6c5ce7;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">${ctaText}</a>
<p style="color:#888;font-size:14px;">Ce lien expire dans 15 minutes. Si tu n'as pas fait cette demande, ignore cet email.</p>
</div>`;

  try {
    const ResendClass = await getResend();
    if (ResendClass && RESEND_API_KEY) {
      const resend = new ResendClass(RESEND_API_KEY);
      await resend.emails.send({ from: RESEND_FROM, to: email, subject, html });
    } else {
      console.error('[auth/request] Resend not available or RESEND_API_KEY not set');
    }
  } catch (err) {
    console.error('[auth/request] Resend error:', err.message);
  }

  // ── ALWAYS return the same response (prevents email enumeration) ──
  return res.status(200).json({
    success: true,
    message: 'Si cet email est valide, un lien a été envoyé.',
  });
}

// ═══════════════════════════════════════════════════════════════════
// VERIFY — GET/POST ?action=verify
// Consumes the one-time token. Creates user, activates premium, issues session.
// ═══════════════════════════════════════════════════════════════════

async function handleVerify(req, res) {
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

  // ── Hash to look up in DB ──
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const sql = createSql();
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

    // ── Mark as used IMMEDIATELY (single-use) ──
    await sql`
      UPDATE magic_links SET used_at = NOW()
      WHERE id = ${link.id} AND used_at IS NULL
    `;

    // ── Find or create user by email ──
    const [upserted] = await sql`
      INSERT INTO users (email) VALUES (${link.email})
      ON CONFLICT (email) DO NOTHING RETURNING id
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

    // ── If purpose='migrate': link existing device_id premium to this user ──
    let migratedCount = 0;

    if (link.purpose === 'migrate' && link.payload?.device_id) {
      const deviceId = link.payload.device_id;
      // Migrate all active, unlinked premium activations for this device
      const result = await sql`
        UPDATE premium_activations
        SET user_id = ${userId}
        WHERE device_id = ${deviceId}
          AND user_id IS NULL
          AND expires_at > NOW()
      `;
      migratedCount = result.count;
      console.log(`[auth/verify] Migrated ${migratedCount} premium activation(s) from device ${deviceId} to user ${userId}`);
    }

    // ── If purpose='activate': finalize premium activation ──
    let premiumResult = null;

    if (link.purpose === 'activate' && link.payload) {
      const { code, durationDays } = link.payload;

      premiumResult = await sql.begin(async (tx) => {
        const [codeRow] = await tx`
          SELECT id, code, duration_days, used, used_at, used_by_device
          FROM access_codes WHERE code = ${code} FOR UPDATE
        `;

        if (!codeRow) return { success: false, error: 'Code non trouvé' };

        // Reactivation: same user, same code, premium expired → re-activate
        if (codeRow.used && codeRow.used_by_device === userId) {
          const [existing] = await tx`
            SELECT expires_at FROM premium_activations
            WHERE user_id = ${userId} ORDER BY activated_at DESC LIMIT 1
          `;

          if (!existing || new Date(existing.expires_at) <= new Date()) {
            const days = durationDays || codeRow.duration_days || 30;
            const [activation] = await tx`
              INSERT INTO premium_activations (user_id, activated_at, expires_at)
              VALUES (${userId}, NOW(), NOW() + INTERVAL '1 day' * ${days})
              RETURNING expires_at
            `;
            return { success: true, duration_days: days, expires_at: activation?.expires_at || null, reactivated: true };
          }
          return { success: true, duration_days: codeRow.duration_days || 30, expires_at: existing.expires_at, reactivated: true };
        }

        if (codeRow.used) return { success: false, error: 'Code déjà utilisé' };

        const [updated] = await tx`
          UPDATE access_codes SET used = true, used_at = NOW(), used_by_device = ${userId}
          WHERE id = ${codeRow.id} AND used = false RETURNING id
        `;
        if (!updated) return { success: false, error: 'Code déjà activé' };

        const days = durationDays || codeRow.duration_days || 30;
        const [activation] = await tx`
          INSERT INTO premium_activations (user_id, activated_at, expires_at)
          VALUES (${userId}, NOW(), NOW() + INTERVAL '1 day' * ${days})
          RETURNING expires_at
        `;
        return { success: true, duration_days: days, expires_at: activation?.expires_at || null };
      });

      if (!premiumResult.success) {
        await sql.end();
        return res.status(400).json({ success: false, error: premiumResult.error });
      }
    }

    // ── Issue session token ──
    const sessionToken = signUserToken(userId);
    await sql.end();

    return res.status(200).json({
      success: true,
      token: sessionToken,
      expiresIn: 30 * 24 * 60 * 60 * 1000,
      email: link.email,
      ...(premiumResult ? {
        premium: {
          activated: true,
          days: premiumResult.duration_days,
          expires_at: premiumResult.expires_at,
          reactivated: premiumResult.reactivated || false,
        },
      } : {}),
      ...(migratedCount > 0 ? {
        migrated: { count: migratedCount },
      } : {}),
    });
  } catch (err) {
    console.error('[auth/verify] Error:', err.message);
    try { await sql.end(); } catch { /* */ }
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main handler — dispatch by action query param
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, POST, OPTIONS', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end('');

  const action = String(req.query?.action || '').trim();

  try {
    // POST ?action=request
    if (req.method === 'POST' && action === 'request') {
      return await handleRequest(req, res);
    }

    // GET/POST ?action=verify
    if ((req.method === 'GET' || req.method === 'POST') && action === 'verify') {
      return await handleVerify(req, res);
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[auth] UNHANDLED:', err.message, err.stack);
    return res.status(500).json({ success: false, error: 'Erreur serveur interne' });
  }
}
