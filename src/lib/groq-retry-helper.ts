// ============================================
// PHASE 5.3.43 — GROQ 429 RETRY-AFTER + THROTTLING HELPER
// ============================================
//
// Pure helper for parsing Retry-After headers and computing bounded backoff.
// Extracted as a standalone module so it can be tested without mocking
// fetch() or calling Groq.
//
// Design principles (per Phase 5.3.43 spec):
//   1. MAX_RETRIES = 1 (no infinite retry loop)
//   2. Retry-After header is RESPECTED when present (not shortened)
//   3. Bounded backoff when Retry-After is absent (INITIAL=2000ms, MAX=10000ms)
//   4. Vercel runtime budget is CHECKED before retrying — if retry would
//      exceed the budget, NO retry (return HTTP_ERROR immediately)
//   5. NO automatic model fallback (qwen → 429 → llama is FORBIDDEN per §23)
//   6. NO artificial hash — failed retry stays HTTP_ERROR with NULL hash
// ============================================

// ─────────────────────────────────────────────────────────────────────
// Constants (per Phase 5.3.43 §9)
// ─────────────────────────────────────────────────────────────────────

export const MAX_RETRIES = 1;
export const INITIAL_BACKOFF_MS = 2000;
export const MAX_BACKOFF_MS = 10000;
/** Safety margin to ensure the retry + response fits within Vercel's budget. */
export const RETRY_SAFETY_BUFFER_MS = 1500;

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface RetryDecision {
  /** True if a retry should be attempted, false if we should give up immediately. */
  shouldRetry: boolean;
  /** Milliseconds to wait before retrying. 0 if shouldRetry is false. */
  waitMs: number;
  /** Source of the wait value: 'retry-after-header' | 'bounded-backoff' | 'none'. */
  waitSource: 'retry-after-header' | 'bounded-backoff' | 'none';
  /** The parsed Retry-After value in ms (null if absent/invalid). */
  retryAfterMs: number | null;
}

export interface BudgetInfo {
  /** Total Vercel function budget in ms (e.g., 8000 for GLOBAL_TIMEOUT_MS). */
  totalBudgetMs: number;
  /** Elapsed time since the function started, in ms. */
  elapsedMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Retry-After header parsing
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse a Retry-After header value into milliseconds.
 *
 * Supports both HTTP-standard forms:
 *   1. <seconds> — e.g., "5" → 5000ms
 *   2. <HTTP-date> — e.g., "Wed, 21 Oct 2026 07:28:00 GMT" → ms until that date
 *
 * Returns null if:
 *   - value is absent (null/undefined/empty)
 *   - value is not parseable as either form
 *   - HTTP-date is in the past (negative delta)
 *
 * @param retryAfterHeader - The raw header value from the Groq response
 * @returns Milliseconds to wait, or null if not parseable
 */
export function parseRetryAfter(retryAfterHeader: string | null | undefined): number | null {
  if (!retryAfterHeader || typeof retryAfterHeader !== 'string') {
    return null;
  }

  const trimmed = retryAfterHeader.trim();
  if (trimmed === '') {
    return null;
  }

  // Form 1: <seconds> — integer or float
  // Matches: "5", "2.5", "0", "120"
  const asSeconds = Number(trimmed);
  if (!isNaN(asSeconds) && asSeconds > 0 && /^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.ceil(asSeconds * 1000);
  }

  // Form 2: <HTTP-date> — e.g., "Wed, 21 Oct 2026 07:28:00 GMT"
  // Date.parse returns NaN for invalid dates, or a timestamp for valid ones
  const parsedDate = Date.parse(trimmed);
  if (!isNaN(parsedDate)) {
    const delta = parsedDate - Date.now();
    if (delta > 0) {
      return delta;
    }
    // Date is in the past — treat as invalid (no wait needed)
    return null;
  }

  // Neither form matched
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Bounded backoff (when Retry-After is absent)
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute a bounded backoff delay for retrying after a 429 when no
 * Retry-After header is provided by the server.
 *
 * Uses a fixed backoff (INITIAL_BACKOFF_MS = 2000ms) clamped to
 * MAX_BACKOFF_MS = 10000ms. No exponential escalation needed since
 * MAX_RETRIES = 1 (only one retry attempt).
 *
 * @returns Bounded backoff in milliseconds
 */
export function computeBoundedBackoff(): number {
  return Math.min(INITIAL_BACKOFF_MS, MAX_BACKOFF_MS);
}

// ─────────────────────────────────────────────────────────────────────
// Retry decision (the core logic)
// ─────────────────────────────────────────────────────────────────────

/**
 * Decide whether to retry after a 429 response, and how long to wait.
 *
 * Logic:
 *   1. If MAX_RETRIES is already reached (retryCount >= MAX_RETRIES=1):
 *      → shouldRetry = false (STOP — no infinite retry)
 *   2. If http_status is NOT 429:
 *      → shouldRetry = false (429 is the ONLY retryable status)
 *   3. Compute waitMs:
 *      a. If Retry-After header present and valid → use that value (RESPECT it)
 *      b. If Retry-After absent → use bounded backoff (2000ms)
 *   4. Check Vercel budget:
 *      If waitMs + RETRY_SAFETY_BUFFER_MS > remainingBudget:
 *      → shouldRetry = false (would risk Vercel timeout → HTTP_ERROR instead)
 *   5. Otherwise: shouldRetry = true, waitMs as computed
 *
 * @param httpStatus - The HTTP status from the Groq response (429 for rate limit)
 * @param retryAfterHeader - The raw Retry-After header value (or null)
 * @param retryCount - How many retries have already been attempted (0 for first attempt)
 * @param budget - Vercel runtime budget info
 * @returns RetryDecision — shouldRetry + waitMs + source + retryAfterMs
 */
export function decideRetry(
  httpStatus: number,
  retryAfterHeader: string | null | undefined,
  retryCount: number,
  budget: BudgetInfo,
): RetryDecision {
  // Condition 1: max retries reached → STOP
  if (retryCount >= MAX_RETRIES) {
    return {
      shouldRetry: false,
      waitMs: 0,
      waitSource: 'none',
      retryAfterMs: parseRetryAfter(retryAfterHeader),
    };
  }

  // Condition 2: only retry on 429 (not on 404, 500, 502, 503, etc.)
  if (httpStatus !== 429) {
    return {
      shouldRetry: false,
      waitMs: 0,
      waitSource: 'none',
      retryAfterMs: null,
    };
  }

  // Condition 3: compute waitMs
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  let waitMs: number;
  let waitSource: 'retry-after-header' | 'bounded-backoff';

  if (retryAfterMs !== null && retryAfterMs > 0) {
    // Retry-After header present and valid — RESPECT it (do NOT shorten)
    waitMs = retryAfterMs;
    waitSource = 'retry-after-header';
  } else {
    // No Retry-After → bounded backoff
    waitMs = computeBoundedBackoff();
    waitSource = 'bounded-backoff';
  }

  // Condition 4: check Vercel budget
  const remainingBudget = budget.totalBudgetMs - budget.elapsedMs;
  if (waitMs + RETRY_SAFETY_BUFFER_MS > remainingBudget) {
    // Retry would risk Vercel timeout → give up immediately
    return {
      shouldRetry: false,
      waitMs: 0,
      waitSource: 'none',
      retryAfterMs,
    };
  }

  // Condition 5: retry is safe
  return {
    shouldRetry: true,
    waitMs,
    waitSource,
    retryAfterMs,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sleep helper (for retry delay)
// ─────────────────────────────────────────────────────────────────────

/**
 * Promise-based sleep. Resolves after the specified milliseconds.
 * Used for retry backoff delays.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
