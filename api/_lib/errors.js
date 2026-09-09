// Shared Error Handler
// Phase L — Normalizes all API error responses with consistent shape,
// correlation IDs, and no internal detail leakage

/**
 * Generate a short correlation ID for error tracking.
 * Format: timestamp-random (e.g., "a1b2c3d4")
 */
function generateCorrelationId() {
  const timestamp = Date.now().toString(36).slice(-4);
  const random = Math.random().toString(36).slice(2, 6);
  return `${timestamp}${random}`;
}

/**
 * Standard error response shape for all VirtuMatch API routes.
 *
 * @param {object} res - Vercel Serverless Function response object
 * @param {number} statusCode - HTTP status code (4xx or 5xx)
 * @param {string} message - Human-readable error message (client-safe, no internals)
 * @param {object} [options]
 * @param {string} [options.code] - Machine-readable error code (e.g., 'RATE_LIMITED', 'INVALID_INPUT')
 * @param {object} [options.meta] - Additional client-safe metadata (e.g., { retryAfter: 60 })
 * @param {Error} [options.cause] - Internal error (logged but NEVER sent to client)
 * @returns {object} Vercel response
 */
export function errorResponse(res, statusCode, message, options = {}) {
  const { code, meta, cause } = options;
  const correlationId = generateCorrelationId();

  // Log internally (with cause stack if available) — never expose to client
  if (cause) {
    console.error(`[error:${correlationId}] ${statusCode} ${code || 'UNKNOWN'}: ${message}`, cause.stack || cause.message);
  } else if (statusCode >= 500) {
    console.error(`[error:${correlationId}] ${statusCode} ${code || 'INTERNAL'}: ${message}`);
  }

  // Client-safe response (NO internal details)
  const body = {
    success: false,
    error: message,
    correlationId,
  };

  if (code) body.code = code;
  if (meta) body.meta = meta;

  return res.status(statusCode).json(body);
}

/**
 * Standard success response shape.
 *
 * @param {object} res - Vercel Serverless Function response object
 * @param {object} data - Response data
 * @param {number} [statusCode=200] - HTTP status code
 * @returns {object} Vercel response
 */
export function successResponse(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    ...data,
  });
}

// ── Common Error Factories ────────────────────────────────────────────────
// Pre-built error responses for common patterns

export function methodNotAllowed(res, allowed = ['GET', 'POST']) {
  return errorResponse(res, 405, `Method not allowed. Use: ${allowed.join(', ')}`, {
    code: 'METHOD_NOT_ALLOWED',
    meta: { allowed },
  });
}

export function rateLimited(res, retryAfter = 60) {
  return errorResponse(res, 429, 'Too many requests. Please try again later.', {
    code: 'RATE_LIMITED',
    meta: { retryAfter },
  });
}

export function unauthorized(res, message = 'Authentication required') {
  return errorResponse(res, 401, message, {
    code: 'UNAUTHORIZED',
  });
}

export function invalidInput(res, message, field = undefined) {
  const meta = field ? { field } : undefined;
  return errorResponse(res, 400, message, {
    code: 'INVALID_INPUT',
    meta,
  });
}

export function notFound(res, resource = 'Resource') {
  return errorResponse(res, 404, `${resource} not found`, {
    code: 'NOT_FOUND',
  });
}

export function internalError(res, cause, message = 'Internal server error') {
  return errorResponse(res, 500, message, {
    code: 'INTERNAL_ERROR',
    cause,
  });
}

export function serviceUnavailable(res, service = 'Service') {
  return errorResponse(res, 503, `${service} temporarily unavailable. Please try again.`, {
    code: 'SERVICE_UNAVAILABLE',
  });
}
