// Structured Logging with PII Redaction
// Phase N — All logs go through this module for:
//   1. Structured JSON output (parseable by log aggregators)
//   2. PII redaction (emails, IPs, device IDs never logged in full)
//   3. Request correlation (requestId in every log entry)
//   4. Log level control via LOG_LEVEL env var

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? LOG_LEVELS.info;

// ── PII Redaction ────────────────────────────────────────────────────────

/**
 * Redact an email address: user@domain.com → u***@domain.com
 */
export function redactEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '[REDACTED]';
  const [local, domain] = email.split('@');
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}

/**
 * Redact an IP address: 192.168.1.100 → 192.168.1.***
 * For IPv6: redact last 2 segments
 */
export function redactIp(ip) {
  if (typeof ip !== 'string') return '[REDACTED]';
  if (ip.includes(':')) {
    // IPv6: redact last 2 segments
    const parts = ip.split(':');
    if (parts.length > 2) {
      parts.splice(-2, 2, '****', '****');
    }
    return parts.join(':');
  }
  // IPv4: redact last octet
  const parts = ip.split('.');
  if (parts.length === 4) {
    parts[3] = '***';
  }
  return parts.join('.');
}

/**
 * Redact a device/token ID: show first 4 + last 4 chars
 * dev-a1b2c3d4e5f6 → dev-***f6
 */
export function redactToken(token) {
  if (typeof token !== 'string') return '[REDACTED]';
  if (token.length <= 8) return '***';
  return `${token.slice(0, 4)}***${token.slice(-2)}`;
}

/**
 * Redact all PII in a log context object.
 * Recursively scans for email, ip, token keys and redacts their values.
 */
export function redactContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;

  const PII_KEYS = new Set([
    'email', 'ip', 'ipAddress', 'clientIp',
    'token', 'deviceToken', 'deviceId', 'device_id',
    'apiKey', 'api_key', 'secret', 'password',
    'authorization', 'cookie',
  ]);

  const result = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (PII_KEYS.has(key)) {
      if (typeof value === 'string') {
        if (key.includes('email')) result[key] = redactEmail(value);
        else if (key.includes('ip') || key === 'clientIp') result[key] = redactIp(value);
        else result[key] = redactToken(value);
      } else {
        result[key] = '[REDACTED]';
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactContext(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Structured Logging ───────────────────────────────────────────────────

/**
 * Create a scoped logger for a module/endpoint.
 *
 * @param {string} module - Module name (e.g., 'auth', 'predictions')
 * @param {object} [baseContext] - Base context merged into every log entry
 * @returns {{ debug, info, warn, error }}
 */
export function createLogger(module, baseContext = {}) {
  function emit(level, message, context = {}) {
    if (LOG_LEVELS[level] < currentLevel) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      ...redactContext({ ...baseContext, ...context }),
    };

    const output = JSON.stringify(entry);

    if (level === 'error') console.error(output);
    else if (level === 'warn') console.warn(output);
    else console.log(output);
  }

  return {
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info:  (msg, ctx) => emit('info', msg, ctx),
    warn:  (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, ctx) => emit('error', msg, ctx),
  };
}
