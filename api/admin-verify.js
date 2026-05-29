// Vercel Serverless Function - Verify Admin Token
// Vérifie un token HMAC-SHA256 signé par admin-login
// Utilisé avant chaque action admin (suppression de code, etc.)

const crypto = require('crypto');

const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

const ALLOWED_ORIGINS = [
  process.env.ALLOWED_ORIGIN || 'https://virtual-match-hitifproject.vercel.app',
  'https://localhost',
];

// Vérification timing-safe du token
function verifyToken(token) {
  if (!token || typeof token !== 'string') return { valid: false };

  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false };

  const [payload, signature] = parts;

  // Décoder le timestamp
  let timestamp;
  try {
    timestamp = parseInt(Buffer.from(payload, 'base64url').toString(), 10);
  } catch {
    return { valid: false };
  }

  if (isNaN(timestamp)) return { valid: false };

  // Vérifier l'expiration
  if (Date.now() - timestamp > SESSION_DURATION_MS) return { valid: false };

  // Recalculer la signature
  const expected = crypto
    .createHmac('sha256', ADMIN_TOKEN_SECRET)
    .update(payload)
    .digest('base64url');

  // Comparaison timing-safe
  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return { valid: false };
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return { valid: false };
  } catch {
    return { valid: false };
  }

  return { valid: true, timestamp };
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

  if (!ADMIN_TOKEN_SECRET) {
    console.error('[admin-verify] ADMIN_TOKEN_SECRET manquant');
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  let body;
  try {
    body = JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  const { token } = body;
  const result = verifyToken(token);

  return res.status(200).json({ valid: result.valid });
};
