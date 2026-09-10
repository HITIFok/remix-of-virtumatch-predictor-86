// Sentry Error Tracking Integration
// Phase Y — Captures unhandled errors, provides performance monitoring
// Only active when SENTRY_DSN env var is set

let _sentry = null;

/**
 * Initialize Sentry if SENTRY_DSN is configured.
 * Call this once at app startup.
 */
export async function initSentry() {
  const SENTRY_DSN = process.env.SENTRY_DSN;
  if (!SENTRY_DSN) return;

  try {
    // Dynamic import — @sentry/node is optional
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
      release: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
      tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
      replaysSessionSampleRate: 0, // No session replays on server
      replaysOnErrorSampleRate: 0,
      // Filter out noisy/non-critical errors
      beforeSend(event) {
        // Don't send 429 rate limit errors
        if (event.tags?.statusCode === 429) return null;
        // Don't send CORS preflight errors
        if (event.tags?.statusCode === 204) return null;
        return event;
      },
    });
    _sentry = Sentry;
    console.log('[sentry] Initialized with DSN');
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
      extra: context,
      tags: {
        module: context.module || 'unknown',
      },
    });
  }
}

/**
 * Add breadcrumb for error tracing.
 */
export function addBreadcrumb(breadcrumb) {
  if (_sentry) {
    _sentry.addBreadcrumb(breadcrumb);
  }
}

/**
 * Set user context for error attribution.
 */
export function setUser(user) {
  if (_sentry) {
    _sentry.setUser(user);
  }
}

/**
 * Check if Sentry is active.
 */
export function isSentryActive() {
  return !!_sentry;
}
