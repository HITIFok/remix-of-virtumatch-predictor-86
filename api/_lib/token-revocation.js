// Token Revocation & Session Invalidation
// Phase AK — Implements token blacklist mechanism for GAP-01 and GAP-02.
// FIX-04: Uses Upstash Redis when available (survives cold starts),
// in-memory Map fallback otherwise.

import crypto from 'crypto';

// ─── Upstash Redis Backend (FIX-04: AUTH-03) ─────────────────────────────────

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_KEY_PREFIX = 'virtumatch:revoke:';
const hasRedis = !!(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);

/**
 * Set a key in Redis with TTL (seconds). Uses Upstash REST API.
 */
async function redisSet(key, value, ttlSeconds) {
  if (!hasRedis) return false;
  try {
    const res = await fetch(`${UPSTASH_REDIS_REST_URL}/set/${REDIS_KEY_PREFIX}${key}/${encodeURIComponent(JSON.stringify(value))}?EX=${ttlSeconds}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get a key from Redis. Returns parsed value or null.
 */
async function redisGet(key) {
  if (!hasRedis) return null;
  try {
    const res = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${REDIS_KEY_PREFIX}${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const { result } = await res.json();
    if (!result) return null;
    return JSON.parse(result);
  } catch {
    return null;
  }
}

/**
 * Delete a key from Redis.
 */
async function redisDel(key) {
  if (!hasRedis) return false;
  try {
    const res = await fetch(`${UPSTASH_REDIS_REST_URL}/del/${REDIS_KEY_PREFIX}${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── In-Memory Blacklist (fallback) ────────────────────────────────────────

const memoryBlacklist = new Map(); // tokenHash → { reason, revokedAt, expiresAt }

// ─── Configuration ────────────────────────────────────────────────────────

const BLACKLIST_MAX_ENTRIES = 50000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastCleanup = Date.now();

/**
 * Token types that support revocation
 */
export const REVOCABLE_TOKEN_TYPES = Object.freeze({
  DEVICE_HMAC: 'DEVICE_HMAC',
  USER_SESSION: 'USER_SESSION',
  ADMIN_SESSION: 'ADMIN_SESSION',
  // MAGIC_LINK is inherently single-use — not in blacklist
});

/**
 * Revocation reasons
 */
export const REVOCATION_REASONS = Object.freeze({
  USER_REQUEST: 'USER_REQUEST',           // GDPR Article 17 erasure
  SECURITY_INCIDENT: 'SECURITY_INCIDENT',  // Compromised token
  ADMIN_ACTION: 'ADMIN_ACTION',            // Admin revocation
  SECRET_ROTATION: 'SECRET_ROTATION',      // During secret rotation grace period
  SESSION_EXPIRY: 'SESSION_EXPIRY',        // Proactive expiry
});

/**
 * Compute a SHA-256 hash of a token for blacklist storage.
 * We never store raw tokens — only hashes.
 */
export function hashTokenForBlacklist(token) {
  if (!token || typeof token !== 'string') return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Add a token to the revocation blacklist.
 * FIX-04: Redis primary backend, in-memory fallback.
 *
 * @param {string} token - The raw token to revoke
 * @param {string} reason - One of REVOCATION_REASONS
 * @param {number} [expiresAt] - When this blacklist entry expires (token natural expiry)
 * @returns {Promise<{ success: boolean, id: string, tokenHash: string, backend: string }>}
 */
export async function revokeToken(token, reason, expiresAt) {
  if (!token || typeof token !== 'string') {
    return { success: false, id: null, tokenHash: null };
  }

  if (!Object.values(REVOCATION_REASONS).includes(reason)) {
    return { success: false, id: null, tokenHash: null };
  }

  const tokenHash = hashTokenForBlacklist(token);
  const now = Date.now();
  const id = `rev-${crypto.randomBytes(8).toString('hex')}`;

  // Default expiry: 30 days from now (max token lifetime)
  const entryExpiry = expiresAt || (now + 30 * 24 * 60 * 60 * 1000);
  const entry = { id, reason, revokedAt: now, expiresAt: entryExpiry };

  // FIX-04: Redis primary, in-memory fallback
  const ttlSeconds = Math.max(1, Math.ceil((entryExpiry - now) / 1000));
  const redisOk = await redisSet(tokenHash, entry, ttlSeconds);
  if (!redisOk) {
    // Fallback to in-memory
    memoryBlacklist.set(tokenHash, entry);

    // Periodic cleanup of expired blacklist entries
    if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
      cleanupExpiredEntries();
      lastCleanup = now;
    }

    // Overflow protection
    if (memoryBlacklist.size > BLACKLIST_MAX_ENTRIES) {
      cleanupExpiredEntries();
    }
  }

  return { success: true, id, tokenHash, backend: redisOk ? 'redis' : 'memory' };
}

/**
 * Revoke all tokens for a device by adding the device_secret hash.
 * This effectively invalidates all HMAC tokens for that device.
 *
 * @param {string} deviceId
 * @param {string} reason
 * @returns {Promise<{ success: boolean, id: string, backend: string }>}
 */
export async function revokeDeviceTokens(deviceId, reason) {
  if (!deviceId || typeof deviceId !== 'string') {
    return { success: false, id: null };
  }

  // We hash the deviceId as the blacklist key
  // Any token verification must also check if the device is revoked
  const deviceHash = hashTokenForBlacklist(`device:${deviceId}`);
  const id = `dev-rev-${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();
  const entry = { id, reason, revokedAt: now, expiresAt: now + 90 * 24 * 60 * 60 * 1000 };

  const ttlSeconds = 90 * 24 * 60 * 60; // 90 days max
  const redisOk = await redisSet(deviceHash, entry, ttlSeconds);
  if (!redisOk) {
    memoryBlacklist.set(deviceHash, entry);
  }

  return { success: true, id, backend: redisOk ? 'redis' : 'memory' };
}

/**
 * Revoke all user sessions by user ID.
 * Used for "logout all devices" or security incident response.
 *
 * @param {string} userId
 * @param {string} reason
 * @returns {Promise<{ success: boolean, id: string, backend: string }>}
 */
export async function revokeUserSessions(userId, reason) {
  if (!userId || typeof userId !== 'string') {
    return { success: false, id: null };
  }

  const userHash = hashTokenForBlacklist(`user:${userId}`);
  const id = `user-rev-${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();
  const entry = { id, reason, revokedAt: now, expiresAt: now + 30 * 24 * 60 * 60 * 1000 };

  const ttlSeconds = 30 * 24 * 60 * 60; // 30 days max session
  const redisOk = await redisSet(userHash, entry, ttlSeconds);
  if (!redisOk) {
    memoryBlacklist.set(userHash, entry);
  }

  return { success: true, id, backend: redisOk ? 'redis' : 'memory' };
}

/**
 * Check if a token has been revoked.
 * FIX-04: Checks Redis first, then in-memory fallback.
 *
 * @param {string} token - The raw token to check
 * @returns {Promise<{ revoked: boolean, reason?: string, revokedAt?: number }>}
 */
export async function isTokenRevoked(token) {
  const tokenHash = hashTokenForBlacklist(token);
  if (!tokenHash) return { revoked: false };

  // FIX-04: Check Redis first, then in-memory fallback
  let entry = await redisGet(tokenHash);
  if (!entry) {
    entry = memoryBlacklist.get(tokenHash);
  }
  if (!entry) return { revoked: false };

  // Check if the blacklist entry itself has expired
  if (Date.now() > entry.expiresAt) {
    memoryBlacklist.delete(tokenHash);
    return { revoked: false };
  }

  return {
    revoked: true,
    reason: entry.reason,
    revokedAt: entry.revokedAt,
  };
}

/**
 * Check if all tokens for a device have been revoked.
 *
 * @param {string} deviceId
 * @returns {Promise<{ revoked: boolean, reason?: string, revokedAt?: number }>}
 */
export async function isDeviceRevoked(deviceId) {
  const deviceHash = hashTokenForBlacklist(`device:${deviceId}`);
  if (!deviceHash) return { revoked: false };

  let entry = await redisGet(deviceHash);
  if (!entry) {
    entry = memoryBlacklist.get(deviceHash);
  }
  if (!entry) return { revoked: false };

  if (Date.now() > entry.expiresAt) {
    memoryBlacklist.delete(deviceHash);
    return { revoked: false };
  }

  return {
    revoked: true,
    reason: entry.reason,
    revokedAt: entry.revokedAt,
  };
}

/**
 * Check if all sessions for a user have been revoked.
 *
 * @param {string} userId
 * @returns {Promise<{ revoked: boolean, reason?: string, revokedAt?: number }>}
 */
export async function isUserRevoked(userId) {
  const userHash = hashTokenForBlacklist(`user:${userId}`);
  if (!userHash) return { revoked: false };

  let entry = await redisGet(userHash);
  if (!entry) {
    entry = memoryBlacklist.get(userHash);
  }
  if (!entry) return { revoked: false };

  if (Date.now() > entry.expiresAt) {
    memoryBlacklist.delete(userHash);
    return { revoked: false };
  }

  return {
    revoked: true,
    reason: entry.reason,
    revokedAt: entry.revokedAt,
  };
}

/**
 * Remove a token from the blacklist (e.g., after secret rotation grace period).
 *
 * @param {string} token
 * @returns {Promise<boolean>} - true if the token was un-revoked
 */
export async function unrevokeToken(token) {
  const tokenHash = hashTokenForBlacklist(token);
  await redisDel(tokenHash);
  return memoryBlacklist.delete(tokenHash);
}

/**
 * Get blacklist statistics for monitoring.
 */
export function getBlacklistStats() {
  const now = Date.now();
  let activeEntries = 0;
  let expiredEntries = 0;
  const byReason = {};

  for (const [, entry] of memoryBlacklist) {
    if (now > entry.expiresAt) {
      expiredEntries++;
    } else {
      activeEntries++;
      byReason[entry.reason] = (byReason[entry.reason] || 0) + 1;
    }
  }

  return {
    totalEntries: memoryBlacklist.size,
    activeEntries,
    expiredEntries,
    maxEntries: BLACKLIST_MAX_ENTRIES,
    byReason,
    redisEnabled: hasRedis,
  };
}

/**
 * Clean up expired blacklist entries.
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of memoryBlacklist) {
    if (now > entry.expiresAt) {
      memoryBlacklist.delete(key);
    }
  }
}

/**
 * Clear the entire blacklist (for testing only).
 */
export function _clearBlacklist() {
  memoryBlacklist.clear();
}

/**
 * GAP resolution status — which gaps this module addresses
 */
export const GAPS_ADDRESSED = Object.freeze([
  {
    gapId: 'GAP-01',
    severity: 'HIGH',
    description: 'No token revocation mechanism',
    resolution: 'Token blacklist with SHA-256 hashes, auto-expiry, device-level revocation, Redis primary backend (FIX-04)',
    status: 'IMPLEMENTED',
  },
  {
    gapId: 'GAP-02',
    severity: 'HIGH',
    description: '30-day sessions without revocation',
    resolution: 'User-level session revocation (revokeUserSessions), admin-triggered or user-triggered, Redis primary (FIX-04)',
    status: 'IMPLEMENTED',
  },
]);
