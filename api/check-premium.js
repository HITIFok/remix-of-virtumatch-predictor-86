// Vercel Serverless Function - Check Premium Status
// Vérifie si un device_id a un accès premium actif via RPC (service_role)
// Endpoint public (pas de token admin requis) mais sécurisé côté serveur

const { createClient } = require('@supabase/supabase-js');

const DATABASE_URL = process.env.VITE_DATABASE_URL || process.env.DATABASE_URL;
const DATABASE_SERVICE_KEY = process.env.DATABASE_SERVICE_KEY;

const ALLOWED_ORIGINS = [
  process.env.ALLOWED_ORIGIN || 'https://virtual-match-hitifproject.vercel.app',
  'https://localhost',
];

module.exports = async function handler(req, res) {
  // CORS dynamique
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!DATABASE_URL || !DATABASE_SERVICE_KEY) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  let body;
  try {
    body = JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  const { deviceId } = body;
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 256) {
    return res.status(400).json({ success: false, error: 'deviceId manquant ou invalide' });
  }

  try {
    const supabase = createClient(DATABASE_URL, DATABASE_SERVICE_KEY);

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
