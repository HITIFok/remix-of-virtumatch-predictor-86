// Vercel Serverless Function — Request Magic Link
// Sends a one-time magic link email via Resend.
// Response is IDENTICAL whether the email exists or not (prevents enumeration).

import crypto from 'crypto';
import { Resend } from 'resend';
import { setCorsHeaders } from '../_lib/cors.js';
import { createSql } from '../_lib/db.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'VirtuMatch <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'https://virtual-match-hitifproject.vercel.app';
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Rate limiting: per email AND per IP (in-memory, same pattern as device-register.js) ──
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

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end('');
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!RESEND_API_KEY) {
    console.error('[auth/request] RESEND_API_KEY not configured');
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

  // ── Validate email ──
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, error: 'Email invalide' });
  }

  // ── Validate purpose ──
  if (purpose !== 'activate' && purpose !== 'login') {
    return res.status(400).json({ success: false, error: "Purpose doit être 'activate' ou 'login'" });
  }

  // ── If purpose='activate', validate code + durationDays ──
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

  // ── Rate limit (per email + per IP) ──
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(email, ip)) {
    return res.status(429).json({
      success: false,
      error: 'Trop de demandes. Réessaie dans quelques minutes.',
    });
  }

  // ── Generate token (cryptographically secure, 32 bytes hex) ──
  const token = crypto.randomBytes(32).toString('hex');

  // ── Store ONLY the SHA-256 hash (never the plaintext token) ──
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
    : 'Connexion à ton compte — VirtuMatch';

  const ctaText = purpose === 'activate' ? 'Activer mon Premium' : 'Me connecter';

  const html = `<div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a2e;">
  <h2 style="color:#6c5ce7;">VirtuMatch</h2>
  <p>Clique sur le bouton ci-dessous pour ${purpose === 'activate' ? 'activer ton code premium' : 'te connecter à ton compte'} :</p>
  <a href="${verifyUrl}" style="display:inline-block;background:#6c5ce7;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">${ctaText}</a>
  <p style="color:#888;font-size:14px;">Ce lien expire dans 15 minutes. Si tu n'as pas fait cette demande, ignore cet email.</p>
</div>`;

  try {
    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: RESEND_FROM,
      to: email,
      subject,
      html,
    });
  } catch (err) {
    // Log but do NOT reveal to client (prevents information leakage)
    console.error('[auth/request] Resend error:', err.message);
  }

  // ── ALWAYS return the same response (prevents email enumeration) ──
  return res.status(200).json({
    success: true,
    message: 'Si cet email est valide, un lien a été envoyé.',
  });
}