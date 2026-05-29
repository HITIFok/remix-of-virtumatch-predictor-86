// Vercel Serverless Function - Check Premium Status (ESM)
// Vérifie si un device_id a un accès premium actif via RPC (service_role)
// CORS dynamique (autorise web + APK, bloque les autres sites)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
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

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data, error } = await supabase.rpc('check_premium_status', {
      p_device_id: deviceId,
    });

    if (error) {
      console.error('[check-premium] RPC error:', error.message);
      return res.status(200).json({ premium: false });
    }

    return res.status(200).json({ premium: data === true });
  } catch (err) {
    console.error('[check-premium] Exception:', err.message);
    return res.status(200).json({ premium: false });
  }
};
