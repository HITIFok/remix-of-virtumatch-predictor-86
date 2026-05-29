// Vercel Serverless Function - Admin Login (ESM)
// Vérifie le mot de passe admin via Supabase RPC (service_role)
// Retourne un token HMAC-SHA256 signé valable 24h

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

// CORS géré par vercel.json (Access-Control-Allow-Origin: *)
// Pas de credentials nécessaires (auth via token HMAC dans le body)

// Signer un timestamp en HMAC-SHA256 → token
function signToken(timestamp) {
  const payload = Buffer.from(String(timestamp)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', ADMIN_TOKEN_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export default async function handler(req, res) {
  // CORS et OPTIONS gérés par vercel.json
  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Validation config
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[admin-login] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant');
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }
  if (!ADMIN_TOKEN_SECRET) {
    console.error('[admin-login] ADMIN_TOKEN_SECRET manquant');
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  // Body parsing (Vercel parse automatiquement le JSON en objet)
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  // Fallback : si Vercel retourne le body en string (rare)
  if (typeof req.body === 'string' && req.body.length > 0) {
    try { Object.assign(body, JSON.parse(req.body)); } catch { /* ignore */ }
  }

  const { password } = body;
  if (!password || typeof password !== 'string' || password.length > 128) {
    return res.status(400).json({ success: false, error: 'Password manquant ou invalide' });
  }

  try {
    // Créer un client Supabase avec service_role (contourne RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Appeler la RPC verify_admin_password avec service_role
    const { data, error } = await supabase.rpc('verify_admin_password', {
      input_password: password,
    });

    if (error) {
      console.error('[admin-login] RPC error:', error.message);
      return res.status(200).json({ success: false, error: 'Erreur serveur' });
    }

    if (data !== true) {
      return res.status(200).json({ success: false, error: 'Mot de passe incorrect' });
    }

    // Mot de passe valide → signer le token
    const timestamp = Date.now();
    const token = signToken(timestamp);

    return res.status(200).json({
      success: true,
      token,
      expiresIn: SESSION_DURATION_MS,
    });
  } catch (err) {
    console.error('[admin-login] Exception:', err.message);
    return res.status(200).json({ success: false, error: 'Erreur serveur' });
  }
};
