// ============================================
// PHASE 5.3.43.7 — FRONTEND RATE-LIMIT RETRY HELPER
// ============================================
//
// Pure helper for the frontend rate-limit retry decision.
// Extracted from enhanceWithAI() for testability.
//
// The frontend retry loop:
//   1. POST /api/analyze-match → receive response
//   2. Check data.rateLimited === true
//   3. If true and retryCount < MAX: wait retryAfterMs → retry
//   4. If false or max reached: proceed with final traces
// ============================================

export const MAX_FRONTEND_RATE_LIMIT_RETRIES = 1;
export const MAX_FRONTEND_RETRY_AFTER_MS = 30000; // 30s cap

export interface FrontendRetryDecision {
  /** True if the frontend should wait and retry. */
  shouldRetry: boolean;
  /** Milliseconds to wait before retrying. 0 if shouldRetry is false. */
  waitMs: number;
  /** Source of the wait: 'retry-after' | 'bounded-backoff' | 'none'. */
  source: 'retry-after' | 'bounded-backoff' | 'none';
}

/**
 * Decide whether the frontend should retry after a rate-limited API response.
 *
 * @param rateLimited - Whether the API response has rateLimited=true
 * @param retryAfterMs - The Retry-After value from the API (null if absent)
 * @param retryCount - How many frontend retries have already been attempted
 * @param maxRetries - MAX_FRONTEND_RATE_LIMIT_RETRIES (default 1)
 * @param maxRetryAfterMs - MAX_FRONTEND_RETRY_AFTER_MS (default 30000)
 */
export function shouldFrontendRetry(
  rateLimited: boolean,
  retryAfterMs: number | null,
  retryCount: number,
  maxRetries: number = MAX_FRONTEND_RATE_LIMIT_RETRIES,
  maxRetryAfterMs: number = MAX_FRONTEND_RETRY_AFTER_MS,
): FrontendRetryDecision {
  // Not rate-limited → no retry
  if (!rateLimited) {
    return { shouldRetry: false, waitMs: 0, source: 'none' };
  }

  // Max retries reached → no retry
  if (retryCount >= maxRetries) {
    return { shouldRetry: false, waitMs: 0, source: 'none' };
  }

  // Compute waitMs
  let waitMs: number;
  let source: 'retry-after' | 'bounded-backoff';

  if (retryAfterMs !== null && retryAfterMs > 0) {
    waitMs = retryAfterMs;
    source = 'retry-after';
  } else {
    // No Retry-After → bounded backoff (2s default)
    waitMs = 2000;
    source = 'bounded-backoff';
  }

  // Check if waitMs exceeds the max cap
  if (waitMs > maxRetryAfterMs) {
    return { shouldRetry: false, waitMs: 0, source: 'none' };
  }

  return { shouldRetry: true, waitMs, source };
}
