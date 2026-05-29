// Vercel Serverless Function - Admin Delete Access Code
// Vérifie le token admin, puis supprime le code via RPC (service_role)

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

const ALLOWED_ORIGINS = [
  process.env.ALLOWED_ORIGIN || 'https://virtual-match-hitifproject.vercel.app',
  'https://localhost',
];

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

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ADMIN_TOKEN_SECRET) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  let body;
  try {
    body = JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  const { token, codeId } = body;

  // 1. Vérifier le token admin
  if (!verifyToken(token).valid) {
    return res.status(401).json({ success: false, error: 'Session admin invalide ou expirée' });
  }

  // 2. Valider codeId (UUID)
  if (!codeId || typeof codeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(codeId)) {
    return res.status(400).json({ success: false, error: 'codeId invalide' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Supprimer via RPC avec service_role (contourne RLS)
    const { data, error } = await supabase.rpc('admin_delete_access_code', {
      p_code_id: codeId,
    });

    if (error) {
      console.error('[admin-delete-code] RPC error:', error.message);
      return res.status(200).json({ success: false, error: 'Erreur lors de la suppression' });
    }

    return res.status(200).json({ success: data === true });
  } catch (err) {
    console.error('[admin-delete-code] Exception:', err.message);
    return res.status(200).json({ success: false, error: 'Erreur serveur' });
  }
};
