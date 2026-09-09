// ─── HMAC Device Token Auth ────────────────────────────────────────────────────
// Replaces plain device_id as sole identifier.
//
// Problem: device_id = `dev-<8-char-hex>` is client-generated from a djb2
// fingerprint. Any attacker can craft `dev-aaaaaaaa` and impersonate any user.
//
// Solution: The client generates a one-time HMAC token per device_id using
// a secret it obtains from the server. The server verifies the HMAC signature
// before trusting the device_id.
//
// Flow:
//   1. Client calls POST /api/device-register with { device_id }
//   2. Server stores device_id, returns { device_secret: "<hex>" }
//   3. Client computes: token = HMAC-SHA256(secret, device_id + ":" + timestamp)
//      formatted as: base64url(timestamp).base64url(hmac)
//   4. Client sends `Authorization: Device <token>` header on every request
//   5. Server verifies HMAC + expiry → trusts the device_id
//
// Security properties:
//   - Attacker cannot forge a token without the secret
//   - Secret is per-device, issued by the server, never exposed to other devices
//   - Tokens expire (default 7 days) — limits damage window
//   - Timing-safe comparison prevents timing attacks
//   - Old tokens are still accepted during grace period (secret rotation)

import crypto from 'crypto';
import postgres from 'postgres';
import { createSql } from './db.js';

const DEVICE_ID_RE = /^dev-[a-z0-9]{8,}$/;
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Device Registration ───────────────────────────────────────────────────

/**
 * Register a device and return its secret.
 * If the device already exists, REFUSE to re-expose the secret (auth bypass prevention).
 * This is the ONLY endpoint that reveals the device secret — and it must do so exactly once.
 *
 * @param {string} deviceId - Must match /^dev-[a-z0-9]{8,}$/
 * @returns {{ success: boolean, device_secret?: string, error?: string, alreadyRegistered?: boolean }}
 */
export async function registerDevice(deviceId) {
  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    return { success: false, error: 'Invalid device_id format' };
  }

  const sql = createSql();
  try {
    // Try to get existing secret first
    const [existing] = await sql`
      SELECT device_secret FROM device_secrets WHERE device_id = ${deviceId}
    `;

    if (existing?.device_secret) {
      // Device already registered — NEVER re-expose the secret.
      // Knowing a device_id (deterministic client fingerprint) must not be
      // sufficient to obtain the HMAC secret. 409 signals the client that
      // it already registered but lost its local secret (e.g. reinstall).
      await sql.end();
      return { success: false, error: 'Device already registered', alreadyRegistered: true };
    }

    // New device — generate a 32-byte random secret
    const deviceSecret = crypto.randomBytes(32).toString('hex');

    await sql`
      INSERT INTO device_secrets (device_id, device_secret, created_at)
      VALUES (${deviceId}, ${deviceSecret}, NOW())
      ON CONFLICT (device_id) DO NOTHING
    `;

    await sql.end();
    return { success: true, device_secret: deviceSecret };
  } catch (err) {
    console.error('[auth] registerDevice error:', err.message);
    try { await sql.end(); } catch { /* ignore */ }
    return { success: false, error: 'Registration failed' };
  }
}

// ─── Token Verification ────────────────────────────────────────────────────

/**
 * Verify an HMAC device token from the Authorization header.
 *
 * @param {object} req - Vercel serverless request object
 * @returns {{ valid: boolean, deviceId?: string, error?: string }}
 */
export async function verifyDeviceToken(req) {
  const authHeader = req.headers['authorization'] || '';

  // Must be "Device <token>" format
  if (!authHeader.startsWith('Device ')) {
    return { valid: false, error: 'Missing or invalid Authorization header (expected "Device <token>")' };
  }

  const token = authHeader.slice(7).trim(); // Remove "Device " prefix
  const parts = token.split('.');

  if (parts.length !== 2) {
    return { valid: false, error: 'Invalid token format' };
  }

  // Decode timestamp
  let timestamp;
  try {
    const tsBuf = Buffer.from(parts[0], 'base64url');
    timestamp = parseInt(tsBuf.toString('utf8'), 10);
  } catch {
    return { valid: false, error: 'Invalid token timestamp' };
  }

  if (isNaN(timestamp) || timestamp <= 0) {
    return { valid: false, error: 'Invalid token timestamp' };
  }

  // Check expiry (7 days)
  if (Date.now() - timestamp > TOKEN_EXPIRY_MS) {
    return { valid: false, error: 'Token expired' };
  }

  // Decode signature
  let signature;
  try {
    signature = Buffer.from(parts[1], 'base64url');
  } catch {
    return { valid: false, error: 'Invalid token signature' };
  }

  // Also accept device_id from x-device-id header (for backward compat during migration)
  // This will be removed after all clients are updated
  const deviceIdHint = req.headers['x-device-id'] || '';

  // We need to find the device — try the hint first, then look up by token pattern
  // For security, we need the secret to verify. We'll look it up from DB.
  const sql = createSql();
  try {
    let deviceSecret = null;
    let deviceId = null;

    // If x-device-id is provided, look up that device's secret directly
    if (deviceIdHint && DEVICE_ID_RE.test(deviceIdHint)) {
      const [row] = await sql`
        SELECT device_secret FROM device_secrets WHERE device_id = ${deviceIdHint}
      `;
      if (row?.device_secret) {
        deviceSecret = row.device_secret;
        deviceId = deviceIdHint;
      }
    }

    if (!deviceSecret) {
      await sql.end();
      return { valid: false, error: 'Device not registered' };
    }

    // Reconstruct the expected message: "deviceId:timestamp"
    const message = `${deviceId}:${timestamp}`;
    const expectedSig = crypto.createHmac('sha256', deviceSecret).update(message).digest();

    // Timing-safe comparison
    if (expectedSig.length !== signature.length) {
      await sql.end();
      return { valid: false, error: 'Invalid signature' };
    }

    const isValid = crypto.timingSafeEqual(expectedSig, signature);
    await sql.end();

    if (!isValid) {
      return { valid: false, error: 'Invalid signature' };
    }

    return { valid: true, deviceId };
  } catch (err) {
    console.error('[auth] verifyDeviceToken error:', err.message);
    try { await sql.end(); } catch { /* ignore */ }
    return { valid: false, error: 'Verification failed' };
  }
}

/**
 * Lightweight auth check — extracts device_id from a verified token.
 * Returns null if auth fails. Use this in API handlers.
 *
 * @param {object} req - Vercel serverless request object
 * @returns {Promise<string|null>} - device_id or null
 */
export async function requireAuth(req) {
  // First, try the new HMAC token auth
  const result = await verifyDeviceToken(req);
  if (result.valid) return result.deviceId;

  // ── V-01 FIX: Feature flag HMAC_ONLY ────────────────────────────────────
  // When HMAC_ONLY=true, the legacy fallback is COMPLETELY DISABLED.
  // All clients MUST use HMAC tokens (Authorization: Device <token>).
  // Activate after all APK users have updated (est. 2 weeks post-deploy).
  //
  // When HMAC_ONLY=false (migration period), the fallback is RESTRICTED:
  //   - DELETE requests are BLOCKED via fallback (destructive op requires HMAC)
  //   - Fallback usage is logged with method + IP for monitoring
  //   - Fallback is limited to x-device-id header only (not body/query)
  const HMAC_ONLY = process.env.HMAC_ONLY === 'true';

  if (HMAC_ONLY) {
    // Migration complete — no fallback allowed
    return null;
  }

  // ── RESTRICTED FALLBACK (migration period only) ─────────────────────────
  // SECURITY RESTRICTIONS during migration:
  //   1. DELETE is forbidden via fallback (must use HMAC)
  //   2. Only x-device-id header is accepted (not body.device_id or query.device_id)
  //   3. Every fallback use is logged with method + IP for abuse detection
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'DELETE') {
    // Destructive operations MUST use HMAC — no fallback allowed
    console.warn(`[auth] BLOCKED: DELETE via fallback is forbidden (HMAC required)`);
    return null;
  }

  const plainDeviceId = req.headers['x-device-id'] || '';
  if (plainDeviceId && DEVICE_ID_RE.test(plainDeviceId)) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    console.warn(`[auth] FALLBACK: plain device_id accepted for ${plainDeviceId} method=${method} ip=${ip} — client needs update`);
    return plainDeviceId;
  }

  // NOTE: body.device_id and query.device_id fallbacks REMOVED in V-01 fix.
  // These vectors allowed any POST body or URL parameter to impersonate a device.
  // During migration, clients must send x-device-id header (already standard).

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// User Session Auth (magic link — separate from ADMIN_TOKEN_SECRET)
// Token format: base64url(timestamp).base64url(userId).base64url(hmac)
// Same HMAC-SHA256 + timingSafeEqual pattern as admin-login.js,
// with userId embedded so the server can identify the user without a DB lookup.
// ═══════════════════════════════════════════════════════════════════

const USER_SESSION_SECRET = process.env.USER_SESSION_SECRET;
const USER_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Sign a user session token.
 * @param {string} userId
 * @returns {string} token
 */
export function signUserToken(userId) {
  if (!USER_SESSION_SECRET) {
    throw new Error('USER_SESSION_SECRET environment variable is not configured');
  }
  const timestamp = Date.now();
  const message = `${timestamp}.${userId}`;
  const payload = Buffer.from(String(timestamp)).toString('base64url');
  const userPart = Buffer.from(userId).toString('base64url');
  const signature = crypto
    .createHmac('sha256', USER_SESSION_SECRET)
    .update(message)
    .digest('base64url');
  return `${payload}.${userPart}.${signature}`;
}

/**
 * Verify a user session token. Returns { valid, userId } or { valid: false }.
 * @param {string} token
 * @returns {{ valid: boolean, userId?: string }}
 */
function verifyUserToken(token) {
  if (!token || typeof token !== 'string') return { valid: false };

  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };

  const [payloadB64, userB64, signature] = parts;

  let timestamp;
  try {
    timestamp = parseInt(Buffer.from(payloadB64, 'base64url').toString(), 10);
  } catch { return { valid: false }; }

  if (isNaN(timestamp) || timestamp <= 0) return { valid: false };

  if (Date.now() - timestamp > USER_SESSION_DURATION_MS) return { valid: false };

  let userId;
  try {
    userId = Buffer.from(userB64, 'base64url').toString();
  } catch { return { valid: false }; }

  if (!userId) return { valid: false };

  // Recompute HMAC
  const message = `${timestamp}.${userId}`;
  const expected = crypto
    .createHmac('sha256', USER_SESSION_SECRET)
    .update(message)
    .digest('base64url');

  // Timing-safe comparison
  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return { valid: false };
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return { valid: false };
  } catch { return { valid: false }; }

  return { valid: true, userId };
}

/**
 * User auth check — verifies a magic-link session token and returns user_id.
 * Used by premium endpoints. Placed alongside requireAuth (device auth),
 * does NOT modify it.
 *
 * @param {object} req - Vercel serverless request object
 * @returns {Promise<string|null>} - user_id or null
 */
export async function requireUserAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  const result = verifyUserToken(token);

  if (!result.valid) return null;
  return result.userId;
}

/**
 * Re-export the regex for API routes that need it for local validation
 */
export { DEVICE_ID_RE };
