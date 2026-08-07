// Vercel Serverless Function - Check Premium Status (ESM)
// Vérifie si un device_id a un accès premium actif via Neon PostgreSQL
// CORS dynamique (autorise web + APK, bloque les autres sites)

import postgres from 'postgres';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!NEON_DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof req.body === 'string' && req.body.length > 0) {
    try { Object.assign(body, JSON.parse(req.body)); } catch { /* ignore */ }
  }

  const { deviceId } = body;
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 256) {
    return res.status(400).json({ success: false, error: 'deviceId manquant ou invalide' });
  }

  // Validate device_id format
  if (!/^dev-\d+-[a-z0-9]+$/.test(deviceId)) {
    return res.status(400).json({ success: false, error: 'Format deviceId invalide' });
  }

  try {
    const [result] = await sql`SELECT check_premium_status(${deviceId}::text)`;

    return res.status(200).json({ premium: result?.check_premium_status === true });
  } catch (err) {
    console.error('[check-premium] Exception:', err.message);
    return res.status(200).json({ premium: false });
  }
};
