// Shared Input Validation Utilities
// Phase M — Centralizes validation for all API inputs
// Prevents injection, validates types, and returns consistent error shapes

/**
 * Validate and sanitize an email address.
 * Returns trimmed email or null if invalid.
 */
export function validateEmail(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  // RFC 5322 simplified — covers 99.9% of valid emails
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(trimmed)) return null;
  if (trimmed.length > 254) return null; // RFC 5321 max
  return trimmed;
}

/**
 * Validate a device ID (HMAC token or plain ID).
 * Must be alphanumeric + dashes, 8-128 chars.
 */
export function validateDeviceId(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 128) return null;
  // Allow alphanumeric, dashes, dots (for HMAC tokens)
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Validate a league ID (must be a known league number).
 */
export function validateLeagueId(raw) {
  const KNOWN_LEAGUES = ['8035', '8060', '8056', '8036', '8037', '8042', '8040', '8038'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!KNOWN_LEAGUES.includes(trimmed)) return null;
  return trimmed;
}

/**
 * Validate a match ID (numeric or alphanumeric, 1-64 chars).
 */
export function validateMatchId(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 64) return null;
  // Alphanumeric + dashes + underscores only
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Validate a purpose string (for auth endpoints).
 */
export function validatePurpose(raw) {
  if (typeof raw !== 'string') return null;
  const VALID = ['activate', 'login', 'migrate'];
  const trimmed = raw.trim().toLowerCase();
  if (!VALID.includes(trimmed)) return null;
  return trimmed;
}

/**
 * Validate a numeric code (for auth verification).
 */
export function validateCode(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const str = String(raw).trim();
  // 6-digit code
  if (!/^\d{6}$/.test(str)) return null;
  return str;
}

/**
 * Validate a duration in days (1-365).
 */
export function validateDuration(raw) {
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > 365) return null;
  return num;
}

/**
 * Validate and sanitize a string input (general purpose).
 * Trims whitespace, enforces max length, rejects control characters.
 */
export function sanitizeString(raw, maxLength = 1024) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  // Reject control characters (except newline/tab in multi-line)
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Validate a pagination limit.
 */
export function validateLimit(raw, maxLimit = 100) {
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > maxLimit) return null;
  return num;
}
