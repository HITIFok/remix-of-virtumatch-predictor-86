// Sentry Error Tracking Integration — Production Grade
// Phase Y + Phase AP (P6) — Captures unhandled errors, performance monitoring
// PII redaction, production tuning, structured breadcrumbs
// Only active when SENTRY_DSN env var is set

let _sentry = null;

// ── PII Fields to Redact ──────────────────────────────────────────────────
// These field names are scrubbed from Sentry events before sending
const PII_FIELDS = new Set([
  'email', 'mail', 'e_mail',
  'device_id', 'device_secret',
  'user_id', 'userId', 'deviceId',
  'ip', 'ip_address', 'remote_addr',
  'authorization', 'cookie', 'session_token',
  'password', 'secret', 'token',
  'phone', 'telephone', 'mobile',
  'ssn', 'social_security',
  'credit_card', 'card_number',
]);

/**
 * Recursively redact PII from an object.
 * Mutates in place for performance (Sentry events are throwaway).
 */
function redactPII(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return obj;
  try {
    for (const key of Object.keys(obj)) {
      if (PII_FIELDS.has(key.toLowerCase())) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        redactPII(obj[key], depth + 1);
      }
    }
  } catch { /* non-iterable or sealed object */ }
  return obj;
}

/**
 * Initialize Sentry if SENTRY_DSN is configured.
 * Call this once at app startup (or in each Vercel serverless invocation).
 */
export async function initSentry() {
  const SENTRY_DSN = process.env.SENTRY_DSN;
  if (!SENTRY_DSN) return;

  const isProduction = (process.env.VERCEL_ENV || process.env.NODE_ENV) === 'production';

  try {
    // Dynamic import — @sentry/node is optional
    const Sentry = await import('@sentry/node');

    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
      release: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
      serverName: 'virtumatch-api',

      // Performance: lower rate in prod to control quota
      tracesSampleRate: isProduction ? 0.05 : 0.2,

      // No session replays on server
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,

      // Max breadcrumbs for context before error
      maxBreadcrumbs: 50,

      // Attach stack traces to messages
      attachStacktrace: true,

      // Send client reports for release health
      sendClientReports: true,

      // Filter events and redact PII before sending
      beforeSend(event, hint) {
        // ── Filter out noisy/non-critical errors ──
        if (event.tags?.statusCode === 429) return null; // Rate limit
        if (event.tags?.statusCode === 204) return null; // CORS preflight
        if (event.tags?.statusCode === 405) return null; // Method not allowed

        // Filter out expected operational errors
        const err = hint?.originalException;
        if (err?.code === 'ECONNRESET') return null;
        if (err?.code === 'ETIMEDOUT') return null;

        // ── Redact PII from event ──
        if (event.request) redactPII(event.request);
        if (event.extra) redactPII(event.extra);
        if (event.user) redactPII(event.user);
        if (event.breadcrumbs) {
          for (const bc of event.breadcrumbs) {
            if (bc.data) redactPII(bc.data);
          }
        }

        return event;
      },

      // Filter performance transactions
      beforeSendTransaction(event) {
        // Don't track health check or data-cleanup spam
        if (event.transaction?.startsWith('/api/verify-predictions') && event.request?.url?.includes('action=health')) return null;
        if (event.transaction?.startsWith('/api/auto-playout') && event.request?.headers?.['x-cron-action'] === 'data-cleanup') return null;
        return event;
      },

      // Default tags for all events
      initialScope: {
        tags: {
          component: 'api',
          framework: 'vercel-serverless',
          project: 'virtumatch-predictor',
        },
      },
    });

    _sentry = Sentry;
    console.log(`[sentry] Initialized (${isProduction ? 'production' : 'development'}) — tracesSampleRate=${isProduction ? 0.05 : 0.2}`);
  } catch (err) {
    console.error('[sentry] Failed to initialize:', err.message);
  }
}

/**
 * Capture an exception in Sentry.
 * Falls back to console.error if Sentry is not configured.
 */
export function captureException(error, context = {}) {
  if (_sentry) {
    _sentry.captureException(error, {
      extra: redactPII({ ...context }),
      tags: {
        module: context.module || 'unknown',
        ...(context.endpoint ? { endpoint: context.endpoint } : {}),
      },
    });
  }
}

/**
 * Capture a structured message (info/warning/error) in Sentry.
 * Useful for tracking security events like auth failures, rate limit hits.
 */
export function captureMessage(message, level = 'info', context = {}) {
  if (_sentry) {
    _sentry.captureMessage(message, {
      level,
      extra: redactPII({ ...context }),
      tags: {
        module: context.module || 'unknown',
      },
    });
  }
}

/**
 * Add breadcrumb for error tracing.
 * Automatically redacts PII from breadcrumb data.
 */
export function addBreadcrumb(breadcrumb) {
  if (_sentry) {
    if (breadcrumb.data) redactPII(breadcrumb.data);
    _sentry.addBreadcrumb(breadcrumb);
  }
}

/**
 * Set user context for error attribution.
 * Only stores non-PII identifier (id), redacts email/name.
 */
export function setUser({ id, ...rest }) {
  if (_sentry) {
    // Only send the user ID — never email, IP, or name
    _sentry.setUser({ id: id ? String(id) : 'anonymous' });
  }
}

/**
 * Clear user context (e.g., on logout or session expiry).
 */
export function clearUser() {
  if (_sentry) {
    _sentry.setUser(null);
  }
}

/**
 * Check if Sentry is active.
 */
export function isSentryActive() {
  return !!_sentry;
}

/**
 * Get current Sentry configuration status for health checks.
 */
export function getSentryStatus() {
  return {
    active: !!_sentry,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    dsnConfigured: !!process.env.SENTRY_DSN,
    piiFieldsRedacted: PII_FIELDS.size,
    version: '2.0.0-AP', // Phase AP
  };
}

// ── Production Integration Helpers ───────────────────────────────────────

/**
 * Sentry-aware error handler for Vercel serverless functions.
 * Wraps a handler to capture unhandled errors.
 */
export function withSentryErrorHandler(handler, handlerName = 'unknown') {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (err) {
      captureException(err, { module: handlerName, method: req.method, url: req.url });
      throw err; // Re-throw so Vercel still handles it
    }
  };
}
