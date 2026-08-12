// Vercel Serverless Function - Admin Login & Verify (ESM)
// Route unifiée : login (body { password }) + verify (body { token })
// Login vérifie le mot de passe admin via Neon PostgreSQL, retourne un token HMAC-SHA256 valable 24h
// Verify vérifie un token HMAC-SHA256 signé par login
// INCLUS : Rate limiting basé sur IP (5 tentatives / 15 minutes) — login uniquement
// INCLUS : CORS dynamique (autorise web + APK, bloque les autres sites)

import crypto from 'crypto';
import postgres from 'postgres';
import { setCorsHeaders, isOriginAllowed } from './_lib/cors.js';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

const sql = postgres(NEON_DATABASE_URL);

// ─── CORS : importé depuis _lib/cors.js ─────────────────────────────────────

// ─── Rate Limiting (in-memory, par instance serverless) ───────────────────────
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
  } catch {
    return { valid: false };
  }

  if (isNaN(timestamp)) return { valid: false };

  // Vérifier l'expiration
  if (Date.now() - timestamp > SESSION_DURATION_MS) return { valid: false };

  // Recalculer la signature
  const expected = crypto
    .createHmac('sha256', ADMIN_TOKEN_SECRET)
    .update(payload)
    .digest('base64url');

  // Comparaison timing-safe
  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return { valid: false };
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return { valid: false };
  } catch {
    return { valid: false };
  }

  return { valid: true, timestamp };
}

// ─── Body helper ─────────────────────────────────────────────────────────────

function parseBody(req) {
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  if (typeof req.body === 'string' && req.body.length > 0) {
    try { Object.assign(body, JSON.parse(req.body)); } catch { /* ignore */ }
  }
  return body;
}

export default async function handler(req, res) {
  // CORS dynamique (autorise web + APK uniquement)
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Bloquer les origines non-autorisées
  const origin = req.headers.origin || '';
  const isSameHost = req.headers.host?.includes('vercel.app') || req.headers.host?.includes('localhost');
  const isAllowed = isOriginAllowed(origin, req.headers.host || '') || (!origin && isSameHost);
  if (!isAllowed) {
    return res.status(403).json({ success: false, error: 'Origin non autorisé' });
  }

  // Validation config
  if (!ADMIN_TOKEN_SECRET) {
    console.error('[admin-login] ADMIN_TOKEN_SECRET manquant');
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  // Body parsing
  const body = parseBody(req);

  // ─── Dispatch : verify vs login ────────────────────────────────────────────
  if (body.token && !body.password) {
    return handleVerify(req, res, body.token);
  }
  return handleLogin(req, res, body);
}

// ─── Verify handler (pas de rate limiting) ───────────────────────────────────
async function handleVerify(req, res, token) {
  const result = verifyToken(token);
  return res.status(200).json({ valid: result.valid });
}

// ─── Login handler (avec rate limiting + DB) ─────────────────────────────────
async function handleLogin(req, res, body) {
  if (!NEON_DATABASE_URL) {
    console.error('[admin-login] NEON_DATABASE_URL manquant');
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  // ─── Rate Limiting ───────────────────────────────────────────────────────
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
    // Direct SQL query to verify admin password
    const [result] = await sql`SELECT verify_admin_password(${password}::text)`;

    const isValid = result?.verify_admin_password === true;

    if (!isValid) {
      return res.status(200).json({
        success: false,
        error: 'Mot de passe ou identifiants incorrects',
        remainingAttempts: rateLimit.remaining,
      });
    }

    // Mot de passe valide → signer le token
    const timestamp = Date.now();
    const token = signToken(timestamp);

    // Réinitialiser le rate limit en cas de succès
    attempts.delete(clientIp);

    return res.status(200).json({
      success: true,
      token,
      expiresIn: SESSION_DURATION_MS,
    });
  } catch (err) {
    console.error('[admin-login] Exception:', err.message);
    return res.status(200).json({ success: false, error: 'Erreur serveur' });
  }
}