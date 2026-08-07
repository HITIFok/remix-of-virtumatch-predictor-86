// Vercel Serverless Function - Admin Delete Access Code (ESM)
// Vérifie le token admin, puis supprime le code via Neon PostgreSQL
// CORS dynamique (autorise web + APK, bloque les autres sites)

import crypto from 'crypto';
import postgres from 'postgres';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

const sql = postgres(NEON_DATABASE_URL);

// CORS dynamique
const ALLOWED_ORIGINS = [
  'https://virtual-match-hitifproject.vercel.app',
  'https://remix-of-virtumatch-predictor-86.vercel.app',
  'https://localhost',
  'capacitor://localhost',
  'http://localhost',
  'http://localhost:5173',
  'http://localhost:4173',
];

function isOriginAllowed(origin, reqHost) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const originHost = new URL(origin).hostname;
    if (originHost === reqHost) return true;
  } catch {}
  return false;
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  if (isOriginAllowed(origin, req.headers.host || '')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
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

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!NEON_DATABASE_URL || !ADMIN_TOKEN_SECRET) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof req.body === 'string' && req.body.length > 0) {
    try { Object.assign(body, JSON.parse(req.body)); } catch { /* ignore */ }
  }

  const { token: tokenFromBody, codeId } = body;

  // 1. Vérifier le token admin (Authorization header prioritaire, fallback body)
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : tokenFromBody;

  if (!verifyToken(token).valid) {
    return res.status(401).json({ success: false, error: 'Session admin invalide ou expirée' });
  }

  // 2. Valider codeId (UUID)
  if (!codeId || typeof codeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(codeId)) {
    return res.status(400).json({ success: false, error: 'codeId invalide' });
  }

  try {
    const [result] = await sql`SELECT admin_delete_access_code(${codeId}::uuid)`;

    return res.status(200).json({ success: result?.admin_delete_access_code === true });
  } catch (err) {
    console.error('[admin-delete-code] Exception:', err.message);
    return res.status(200).json({ success: false, error: 'Erreur serveur' });
  }
};
