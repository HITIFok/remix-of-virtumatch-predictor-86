// Vercel Serverless Function - Admin Get/Save Codes (ESM)
// Vérifie le token HMAC admin, puis lit/crée des codes via Neon PostgreSQL
// CORS dynamique (autorise web + APK, bloque les autres sites)
// Token passé via Authorization: Bearer <token> header

import crypto from 'crypto';
import postgres from 'postgres';
import { setCorsHeaders } from './_lib/cors.js';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

const sql = postgres(NEON_DATABASE_URL);

// CORS : importé depuis _lib/cors.js

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

  // Vérifier le token admin (via Authorization header: Bearer <token>)
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!verifyToken(token).valid) {
    return res.status(401).json({ success: false, error: 'Session admin invalide ou expirée' });
  }

  try {
    if (req.method === 'GET') {
      // ═══ LIRE tous les codes ═══
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

    if (req.method === 'POST') {
      // ═══ CRÉER un nouveau code ═══
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (typeof req.body === 'string' && req.body.length > 0) {
        try { Object.assign(body, JSON.parse(req.body)); } catch { /* ignore */ }
      }

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
  } catch (err) {
    console.error('[admin-codes] Exception:', err.message);
    return res.status(200).json({ success: false, error: 'Erreur serveur' });
  }
};