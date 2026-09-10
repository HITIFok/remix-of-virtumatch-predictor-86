// Secret Rotation Utilities
// Phase Z — Automated secret rotation support
//
// Secrets that should be rotated periodically:
//   - HMAC_DEVICE_SECRET  — device token signing
//   - ADMIN_TOKEN_SECRET  — admin session signing
//   - USER_SESSION_SECRET — user session signing
//   - CRON_SECRET        — cron job authentication
//   - SCRAPER_PUSH_KEY   — scraper push authentication
//   - RESEND_API_KEY     — email service key
//
// Rotation strategy:
//   1. Generate new secret
//   2. Store both old + new (grace period)
//   3. Accept both during grace period
//   4. After grace period, remove old secret

import crypto from 'crypto';

/**
 * Generate a cryptographically secure secret of specified length.
 * @param {number} bytes - Number of random bytes (default: 32)
 * @returns {string} Hex-encoded secret
 */
export function generateSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Secret rotation state for a given secret name.
 */
export const SECRET_ROTATION_SCHEDULE = {
  HMAC_DEVICE_SECRET:  { rotationDays: 90,  gracePeriodHours: 24, description: 'Device HMAC signing key' },
  ADMIN_TOKEN_SECRET:  { rotationDays: 90,  gracePeriodHours: 48, description: 'Admin session signing key' },
  USER_SESSION_SECRET: { rotationDays: 90,  gracePeriodHours: 72, description: 'User session signing key (longer grace for 30-day sessions)' },
  CRON_SECRET:         { rotationDays: 180, gracePeriodHours: 1,  description: 'Cron job authentication key' },
  SCRAPER_PUSH_KEY:    { rotationDays: 180, gracePeriodHours: 1,  description: 'Scraper push authentication key' },
  RESEND_API_KEY:      { rotationDays: 365, gracePeriodHours: 0,  description: 'Email service API key (rotate via Resend dashboard)' },
};

/**
 * Get all secrets that are due for rotation.
 * @param {object} currentDates - Map of secret name → last rotation ISO date
 * @returns {Array<{ name: string, daysOverdue: number, schedule: object }>}
 */
export function getOverdueSecrets(currentDates = {}) {
  const now = Date.now();
  const overdue = [];

  for (const [name, schedule] of Object.entries(SECRET_ROTATION_SCHEDULE)) {
    const lastRotated = currentDates[name];
    if (!lastRotated) {
      overdue.push({ name, daysOverdue: Infinity, schedule });
      continue;
    }

    const elapsed = now - new Date(lastRotated).getTime();
    const elapsedDays = elapsed / (24 * 60 * 60 * 1000);
    if (elapsedDays > schedule.rotationDays) {
      overdue.push({
        name,
        daysOverdue: Math.round(elapsedDays - schedule.rotationDays),
        schedule,
      });
    }
  }

  return overdue;
}

/**
 * Verify a secret during grace period (accepts both old and new).
 * @param {string} provided - The secret provided in the request
 * @param {string} current - The current (new) secret
 * @param {string} [previous] - The previous (old) secret during grace period
 * @returns {boolean}
 */
export function verifySecretWithGrace(provided, current, previous = null) {
  if (!provided) return false;

  try {
    const provBuf = Buffer.from(provided);
    const curBuf = Buffer.from(current);

    if (provBuf.length === curBuf.length && crypto.timingSafeEqual(provBuf, curBuf)) {
      return true;
    }

    // Check previous secret during grace period
    if (previous) {
      const prevBuf = Buffer.from(previous);
      if (provBuf.length === prevBuf.length && crypto.timingSafeEqual(provBuf, prevBuf)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * List all required secrets and their status.
 */
export function auditSecrets() {
  const required = Object.keys(SECRET_ROTATION_SCHEDULE);
  const results = {};

  for (const name of required) {
    const value = process.env[name];
    results[name] = {
      configured: !!value,
      length: value ? value.length : 0,
      rotationDays: SECRET_ROTATION_SCHEDULE[name].rotationDays,
      description: SECRET_ROTATION_SCHEDULE[name].description,
    };
  }

  return results;
}
