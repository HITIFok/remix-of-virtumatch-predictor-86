// Vercel Serverless Function - Admin Get/Save Codes (ESM)
// Vérifie le token HMAC admin, puis lit/crée des codes via Supabase (service_role)
// CORS dynamique (autorise web + APK, bloque les autres sites)
// Token passé via Authorization: Bearer <token> header

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

// CORS dynamique
const ALLOWED_ORIGINS = [
  'https://virtual-match-hitifproject.vercel.app',
  'https://localhost',
  'capacitor://localhost',
  'http://localhost',
  'http://localhost:5173',
  'http://localhost:4173',
];

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ADMIN_TOKEN_SECRET) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  // Vérifier le token admin (via Authorization header: Bearer <token>)
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!verifyToken(token).valid) {
    return res.status(401).json({ success: false, error: 'Session admin invalide ou expirée' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    if (req.method === 'GET') {
      // ═══ LIRE tous les codes ═══
      const { data, error } = await supabase
        .from('access_codes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[admin-codes] GET error:', error.message);
        return res.status(200).json({ success: false, error: 'Erreur lecture codes' });
      }

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

      const { data, error } = await supabase
        .from('access_codes')
        .insert({ code, duration_days: durationDays, used: false })
        .select()
        .single();

      if (error) {
        console.error('[admin-codes] POST error:', error.message);
        return res.status(200).json({ success: false, error: error.message });
      }

      return res.status(200).json({ success: true, code: data.code });
    }
  } catch (err) {
    console.error('[admin-codes] Exception:', err.message);
    return res.status(200).json({ success: false, error: 'Erreur serveur' });
  }
};
