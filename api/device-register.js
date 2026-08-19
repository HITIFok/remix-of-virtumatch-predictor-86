// Vercel Serverless Function — Device Registration for HMAC Auth
// Called once per device to obtain a per-device secret.
// The client stores this secret in IndexedDB/localStorage and uses it
// to sign all subsequent API requests.

import { setCorsHeaders } from './_lib/cors.js';
import { registerDevice, DEVICE_ID_RE } from './_lib/auth.js';

// Rate limit: 5 registrations per IP per minute (prevents secret enumeration)
const registerAttempts = new Map();
const MAX_REGISTER_PER_MIN = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const windowKey = Math.floor(now / 60000);
  const key = `${ip}:${windowKey}`;
  const record = registerAttempts.get(key);

  if (!record || now - record.firstAttempt > 60000) {
    registerAttempts.set(key, { count: 1, firstAttempt: now });
    return true;
  }

  if (record.count >= MAX_REGISTER_PER_MIN) {
    return false;
  }
  record.count++;
  return true;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type, x-device-id');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Rate limit
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ success: false, error: 'Too many registration attempts' });
  }

  // Extract device_id from header (primary) or body (fallback)
  let deviceId = req.headers['x-device-id'] || '';

  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      deviceId = String(body.device_id || '').trim();
    } catch { /* ignore */ }
  }

  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    return res.status(400).json({
      success: false,
      error: 'Valid device_id required (x-device-id header or body.device_id)',
    });
  }

  const result = await registerDevice(deviceId);

  if (!result.success) {
    return res.status(500).json(result);
  }

  return res.status(200).json({
    success: true,
    device_secret: result.device_secret,
  });
}
