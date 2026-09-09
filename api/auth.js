// Vercel Serverless Function — Magic Link Auth (unified)
// Routes (single function to stay within Vercel Hobby 12-function limit):
//   POST ?action=request  → Send magic link email (body: { email, purpose, code?, durationDays? })
//   GET  ?action=verify&token=xxx  → Verify magic link from email
//   POST ?action=verify         → Verify magic link from body { token }
//   GET  ?action=latest-apk     → Fetch latest GitHub Actions APK artifact URL

import crypto from 'crypto';
import { setCorsHeaders } from './_lib/cors.js';
import { createSql } from './_lib/db.js';
import { signUserToken } from './_lib/auth.js';
import { getResend, RESEND_FROM, APP_URL } from './_lib/resend.js';
import { createRateLimiter } from './_lib/ratelimit.js';
import { getClientIp } from './_lib/request.js';
import { errorResponse, methodNotAllowed, rateLimited, invalidInput, internalError, serviceUnavailable, successResponse } from './_lib/errors.js';
import { validateEmail, validatePurpose, validateCode, validateDuration, validateDeviceId, sanitizeString } from './_lib/validate.js';
import { createLogger, redactEmail, redactIp, redactToken } from './_lib/logger.js';

const log = createLogger('auth');

// ── Rate limiting: per email AND per IP (shared module, Phase I) ──
const authEmailLimiter = createRateLimiter('auth-email', { max: 3, windowMs: 15 * 60 * 1000 });
const authIpLimiter = createRateLimiter('auth-ip', { max: 3, windowMs: 15 * 60 * 1000 });

// ═══════════════════════════════════════════════════════════════════
// REQUEST — POST ?action=request
// Sends a one-time magic link email via Resend.
// Response is IDENTICAL whether the email exists or not.
// ═══════════════════════════════════════════════════════════════════

async function handleRequest(req, res) {
  const resend = await getResend();
  if (!resend) {
    log.error('Resend not configured');
    return serviceUnavailable(res, 'Email service');
  }

  // ── Parse body ──
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ success: false, error: 'JSON invalide' });
  }

  const rawEmail = validateEmail(body.email);
  const rawPurpose = validatePurpose(body.purpose);

  if (!rawEmail) {
    return invalidInput(res, 'Email invalide', 'email');
  }
  const email = rawEmail;

  if (!rawPurpose) {
    return invalidInput(res, "Purpose doit être 'activate', 'login' ou 'migrate'", 'purpose');
  }
  const purpose = rawPurpose;

  // ── If purpose='activate', validate code + durationDays ──
  // ── If purpose='migrate', extract device_id from request ──
  let payload = null;
  if (purpose === 'activate') {
    const code = String(body.code || '').trim();
    const durationDays = parseInt(body.durationDays, 10);

    const sanitizedCode = sanitizeString(code, 50);
    if (!sanitizedCode || sanitizedCode.length < 4) {
      return invalidInput(res, 'Code invalide', 'code');
    }
    const validDuration = validateDuration(durationDays);
    if (!validDuration) {
      return invalidInput(res, 'Durée invalide (1-365 jours)', 'durationDays');
    }
    payload = { code: sanitizedCode, durationDays: validDuration };
  }

  if (purpose === 'migrate') {
    // V-01 NOTE: For migrate purpose, device_id is stored in the magic link payload
    // (not used for auth). The actual migration happens in handleVerify when the
    // user clicks the magic link. device_id here is informational only.
    // Prefer x-device-id header; body.device_id is legacy fallback.
    const rawDeviceId = req.headers['x-device-id'] || String(body.device_id || '').trim();
    const deviceId = validateDeviceId(rawDeviceId);
    if (!deviceId || !/^dev-[a-z0-9]{8,}$/.test(deviceId)) {
      return invalidInput(res, 'Appareil non reconnu', 'device_id');
    }
    const ip = getClientIp(req);
    log.warn('Migrate request received', { device_id: deviceId, ip });
    payload = { device_id: deviceId };
  }

  // ── Rate limit ──
  const ip = getClientIp(req);
  if (!authEmailLimiter.check(email).allowed || !authIpLimiter.check(ip).allowed) {
    log.warn('Rate limited', { email, ip });
    return rateLimited(res, 900);
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
        ${payload || null},
        NOW() + INTERVAL '15 minutes'
      )
    `;
    await sql.end();
  } catch (err) {
    log.error('DB error inserting magic link', undefined, { cause: err });
    try { await sql.end(); } catch { /* */ }
    return internalError(res, err);
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
    await resend.emails.send({ from: RESEND_FROM, to: email, subject, html });
  } catch (err) {
    log.error('Resend send error', undefined, { cause: err });
  }

  // ── ALWAYS return the same response (prevents email enumeration) ──
  return successResponse(res, { message: 'Si cet email est valide, un lien a été envoyé.' });
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
      return invalidInput(res, 'JSON invalide');
    }
  }

  if (!token || token.length < 16) {
    return invalidInput(res, 'Token manquant ou invalide', 'token');
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
      return invalidInput(res, 'Lien invalide, expiré ou déjà utilisé.', 'token');
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
      return internalError(res, null, 'Erreur lors de la création du compte');
    }

    // ── Safely parse payload (JSONB may come back as string or object) ──
    const parsedPayload = typeof link.payload === 'string'
      ? (() => { try { return JSON.parse(link.payload); } catch { return null; } })()
      : (link.payload || null);

    // ── If purpose='migrate': link existing device_id premium to this user ──
    let migratedCount = 0;

    if (link.purpose === 'migrate' && parsedPayload?.device_id) {
      const deviceId = parsedPayload.device_id;
      // Migrate all active, unlinked premium activations for this device
      const result = await sql`
        UPDATE premium_activations
        SET user_id = ${userId}
        WHERE device_id = ${deviceId}
          AND user_id IS NULL
          AND expires_at > NOW()
      `;
      migratedCount = result.count;
      log.info('Migrated premium activations', { device_id: deviceId, userId, migratedCount });
    }

    // ── If purpose='activate': finalize premium activation ──
    let premiumResult = null;

    if (link.purpose === 'activate' && parsedPayload) {
      const { code, durationDays } = parsedPayload;

      if (!code) {
        log.error('Activate link missing code in payload', { linkId: link.id });
        await sql.end();
        return invalidInput(res, 'Lien invalide: données manquantes', 'code');
      }

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
    log.error('Verify error', undefined, { cause: err });
    try { await sql.end(); } catch { /* */ }
    return internalError(res, err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// LATEST APK — GET ?action=latest-apk
// Proxies GitHub Releases API (avoids CSP connect-src block).
// Release assets are permanent + public — no expiration unlike artifacts.
// 5-minute in-memory cache, stale fallback on error.
// ═══════════════════════════════════════════════════════════════════

const GITHUB_REPO = 'HITIFok/remix-of-virtumatch-predictor-86';
let _apkCache = { url: null, ts: 0 };
const APK_CACHE_MS = 5 * 60 * 1000;

async function handleLatestApk(req, res) {
  const now = Date.now();

  // Return cached URL if fresh
  if (_apkCache.url && (now - _apkCache.ts) < APK_CACHE_MS) {
    return res.status(200).json({ url: _apkCache.url });
  }

  try {
    const ghHeaders = { Accept: 'application/vnd.github+json' };
    const ghToken = process.env.GITHUB_TOKEN;
    if (ghToken) ghHeaders['Authorization'] = `Bearer ${ghToken}`;

    // Query the "apk-latest" release for its APK asset (permanent, public)
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/apk-latest`,
      { headers: ghHeaders, signal: AbortSignal.timeout(5000) }
    );

    if (!ghRes.ok) throw new Error(`GitHub ${ghRes.status}`);
    const data = await ghRes.json();

    // Find the APK asset in the release
    const apkAsset = data.assets?.find(a => /\.apk$/i.test(a.name));
    if (!apkAsset?.browser_download_url) {
      return res.status(200).json({ url: _apkCache.url || null });
    }

    const url = apkAsset.browser_download_url;
    _apkCache = { url, ts: now };

    return res.status(200).json({ url });
  } catch (err) {
    log.error('Latest APK fetch error', undefined, { cause: err });
    // Stale fallback
    if (_apkCache.url) {
      return res.status(200).json({ url: _apkCache.url });
    }
    return res.status(200).json({ url: null });
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

    // GET ?action=latest-apk
    if (req.method === 'GET' && action === 'latest-apk') {
      return await handleLatestApk(req, res);
    }

    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (err) {
    log.error('Unhandled error', undefined, { cause: err });
    return internalError(res, err, 'Erreur serveur interne');
  }
}
