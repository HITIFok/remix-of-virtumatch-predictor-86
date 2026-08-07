// Vercel Serverless Function - Check Premium Status (ESM)
// Vérifie si un device_id a un accès premium actif via Neon PostgreSQL
// CORS dynamique (autorise web + APK, bloque les autres sites)

import postgres from 'postgres';
import { setCorsHeaders } from './_lib/cors.js';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

const sql = postgres(NEON_DATABASE_URL);

// CORS : importé depuis _lib/cors.js

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type');

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
