// Vercel Serverless Function - Check Premium Status (ESM)
// Vérifie si un device_id a un accès premium actif via RPC (service_role)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// CORS géré par vercel.json (Access-Control-Allow-Origin: *)

export default async function handler(req, res) {
  // CORS et OPTIONS gérés par vercel.json
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
