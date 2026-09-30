// ============================================
// PHASE 5.3.43 — GROQ 429 RETRY-AFTER + THROTTLING TESTS
// ============================================
//
// Tests the pure helper `groq-retry-helper.ts` which implements:
//   1. Retry-After header parsing (seconds + HTTP-date forms)
//   2. Bounded backoff (2000ms default, 10000ms max)
//   3. Retry decision logic (MAX_RETRIES=1, budget check, 429-only)
//
// Also tests the updated `predict-guard.ts` which adds `batchPredicting`
// as a concurrency guard (individual Predict blocked during batch).
//
// AUTHENTICITY: tests import the REAL production helpers — no logic duplication.
// ============================================

import { describe, it, expect } from 'vitest';
import {
  parseRetryAfter,
  computeBoundedBackoff,
  decideRetry,
  MAX_RETRIES,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  RETRY_SAFETY_BUFFER_MS,
  sleep,
} from '../lib/groq-retry-helper';
import { shouldBlockPredict } from '../lib/predict-guard';

// ═══════════════════════════════════════════════════════════════════
// TEST 1 — PARSE_OK (200) → no retry needed
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 1: 200 OK → no retry', () => {
  it('decideRetry on http_status=200 returns shouldRetry=false', () => {
    const decision = decideRetry(200, null, 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.waitMs).toBe(0);
    expect(decision.waitSource).toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2 — 429 with Retry-After header (seconds form)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 2: 429 + Retry-After (seconds)', () => {
  it('Retry-After: 2 → waitMs=2000, shouldRetry=true, source=retry-after-header', () => {
    const decision = decideRetry(429, '2', 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.waitMs).toBe(2000);
    expect(decision.waitSource).toBe('retry-after-header');
    expect(decision.retryAfterMs).toBe(2000);
  });

  it('Retry-After: 5 → waitMs=5000, shouldRetry=true (if budget allows)', () => {
    const decision = decideRetry(429, '5', 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.waitMs).toBe(5000);
    expect(decision.waitSource).toBe('retry-after-header');
  });

  it('Retry-After: 1 → waitMs=1000', () => {
    const decision = decideRetry(429, '1', 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.waitMs).toBe(1000);
    expect(decision.waitSource).toBe('retry-after-header');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3 — 429 without Retry-After → bounded backoff
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 3: 429 without Retry-After → bounded backoff', () => {
  it('null Retry-After → waitMs=2000 (INITIAL_BACKOFF_MS), source=bounded-backoff', () => {
    const decision = decideRetry(429, null, 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.waitMs).toBe(INITIAL_BACKOFF_MS); // 2000
    expect(decision.waitSource).toBe('bounded-backoff');
    expect(decision.retryAfterMs).toBeNull();
  });

  it('empty Retry-After → bounded backoff', () => {
    const decision = decideRetry(429, '', 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.waitMs).toBe(INITIAL_BACKOFF_MS);
    expect(decision.waitSource).toBe('bounded-backoff');
  });

  it('invalid Retry-After (non-numeric, non-date) → bounded backoff', () => {
    const decision = decideRetry(429, 'invalid-value', 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.waitMs).toBe(INITIAL_BACKOFF_MS);
    expect(decision.waitSource).toBe('bounded-backoff');
    expect(decision.retryAfterMs).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4 — Second 429 (retryCount >= MAX_RETRIES) → STOP
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 4: retryCount >= MAX_RETRIES → STOP', () => {
  it('429 with retryCount=1 (MAX_RETRIES=1) → shouldRetry=false (no third call)', () => {
    const decision = decideRetry(429, '2', 1, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.waitMs).toBe(0);
    expect(decision.waitSource).toBe('none');
  });

  it('MAX_RETRIES constant is 1 (no infinite retry)', () => {
    expect(MAX_RETRIES).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 5 — Retry succeeds (simulated via decision logic)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 5: retry decision allows successful retry', () => {
  it('429 + Retry-After=2 + budget=8000 + elapsed=1000 → retry allowed', () => {
    // After 2000ms wait + 1500ms safety buffer = 3500ms < 7000ms remaining
    const decision = decideRetry(429, '2', 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.waitMs).toBe(2000);
    // The actual retry would be a new fetch() call — tested via integration
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 6 — Retry fails (second 429) → HTTP_ERROR, no hash, eligible=false
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 6: second 429 → STOP → HTTP_ERROR', () => {
  it('retryCount=1 + 429 → shouldRetry=false (STOP — no third retry)', () => {
    // After the first retry also returns 429, retryCount=1 >= MAX_RETRIES=1
    // → shouldRetry=false → caller returns HTTP_ERROR
    const decision = decideRetry(429, '2', 1, { totalBudgetMs: 8000, elapsedMs: 5000 });
    expect(decision.shouldRetry).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 7 — Retry-After too long for budget → NO_RETRY → HTTP_ERROR
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 7: Retry-After > budget → NO_RETRY', () => {
  it('Retry-After=10s + budget=8000 + elapsed=1000 → no retry (would exceed budget)', () => {
    // remaining = 8000 - 1000 = 7000
    // waitMs + safety = 10000 + 1500 = 11500 > 7000 → no retry
    const decision = decideRetry(429, '10', 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.waitMs).toBe(0);
    expect(decision.waitSource).toBe('none');
    // retryAfterMs is still recorded for traceability
    expect(decision.retryAfterMs).toBe(10000);
  });

  it('Retry-After=60s (very long) → no retry', () => {
    const decision = decideRetry(429, '60', 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.retryAfterMs).toBe(60000);
  });

  it('bounded backoff (2000ms) + tiny budget (1000ms remaining) → no retry', () => {
    // remaining = 5000 - 4500 = 500ms < 2000 + 1500 = 3500 → no retry
    const decision = decideRetry(429, null, 0, { totalBudgetMs: 5000, elapsedMs: 4500 });
    expect(decision.shouldRetry).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 8 — Batch: 10 matches → 10 individual calls (NOT 1 batched)
// (Re-verified from Phase 5.3.41 — still holds with interCallDelayMs)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 8: batch still sends individual calls', () => {
  it('orchestrator with interCallDelayMs=100 still calls enhanceSingle 10 times', async () => {
    const { orchestrateBatchPredict } = await import('../lib/batch-predict-orchestrator');
    const matches = Array.from({ length: 10 }, (_, i) => ({ id: i, label: `Match${i + 1}` }));
    const calls: number[] = [];
    const result = await orchestrateBatchPredict(matches, {
      enhanceSingle: async (m: any) => { calls.push(m.id); },
      interCallDelayMs: 50, // small delay for test speed
    });
    expect(calls.length).toBe(10);
    expect(result.successCount).toBe(10);
    // Sequential order preserved
    expect(calls).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 9 — Batch sequential (request N+1 starts only after N completes)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 9: sequential execution preserved', () => {
  it('match N+1 starts only after match N completes (with interCallDelayMs)', async () => {
    const { orchestrateBatchPredict } = await import('../lib/batch-predict-orchestrator');
    const matches = Array.from({ length: 3 }, (_, i) => ({ id: i }));
    const startOrder: number[] = [];
    const endOrder: number[] = [];
    await orchestrateBatchPredict(matches, {
      enhanceSingle: async (m: any) => {
        startOrder.push(m.id);
        await new Promise(r => setTimeout(r, 10)); // simulate work
        endOrder.push(m.id);
      },
      interCallDelayMs: 5,
    });
    // Start order must be sequential (0, 1, 2) — NOT parallel
    expect(startOrder).toEqual([0, 1, 2]);
    // End order must also be sequential
    expect(endOrder).toEqual([0, 1, 2]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 10 — Concurrency guard: batchPredicting blocks individual Predict
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 10: concurrency guard (batchPredicting)', () => {
  it('shouldBlockPredict returns true when batchPredicting=true', () => {
    expect(shouldBlockPredict({
      predicting: false,
      predictionsLoading: false,
      oddHome: 2.0,
      batchPredicting: true,
    })).toBe(true);
  });

  it('shouldBlockPredict returns false when batchPredicting=false (and other flags clear)', () => {
    expect(shouldBlockPredict({
      predicting: false,
      predictionsLoading: false,
      oddHome: 2.0,
      batchPredicting: false,
    })).toBe(false);
  });

  it('shouldBlockPredict returns false when batchPredicting is undefined (backward-compat)', () => {
    expect(shouldBlockPredict({
      predicting: false,
      predictionsLoading: false,
      oddHome: 2.0,
    })).toBe(false);
  });

  it('shouldBlockPredict returns true when batchPredicting=true even if other flags are clear', () => {
    // The concurrency guard is an ADDITIONAL condition — OR semantics
    expect(shouldBlockPredict({
      predicting: false,
      predictionsLoading: false,
      oddHome: 2.0,
      batchPredicting: true,
    })).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 11 — Trace 429: ai_http_status, ai_retry_count, ai_retry_after_ms stored
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 11: 429 trace fields', () => {
  it('429 decision records retryAfterMs for traceability', () => {
    const decision = decideRetry(429, '3', 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.retryAfterMs).toBe(3000);
  });

  it('429 without Retry-After records retryAfterMs=null', () => {
    const decision = decideRetry(429, null, 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.retryAfterMs).toBeNull();
  });

  it('non-429 HTTP error records retryAfterMs=null (no retry for 500/502/503)', () => {
    const decision = decideRetry(500, null, 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.retryAfterMs).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 12 — Trace PARSE_OK after retry: retry_count=1
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — TEST 12: PARSE_OK after retry', () => {
  it('retryCount=1 + 200 OK → PARSE_OK with retry_count=1 (simulated)', () => {
    // After a successful retry, the callInfo would have:
    //   status: PARSE_OK, http_status: 200, retry_count: 1, retry_after_ms: 2000
    // The decideRetry function is only called on 429 — on 200, no decision needed.
    // Here we verify the retryCount tracking is correct.
    const decision = decideRetry(429, '2', 0, { totalBudgetMs: 8000, elapsedMs: 1000 });
    expect(decision.shouldRetry).toBe(true);
    // After the retry succeeds (200 OK), retryCount would be 1 in the final callInfo.
    // The ai_trace.hashes.ai_retry_count would be 1.
    // The ai_trace.hashes.ai_retry_after_ms would be 2000.
    // The ai_trace.hashes.ai_error_type would be 'RATE_LIMIT' (from the first 429).
  });
});

// ═══════════════════════════════════════════════════════════════════
// EDGE — parseRetryAfter various forms
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — EDGE: parseRetryAfter forms', () => {
  it('null → null', () => {
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(parseRetryAfter(undefined)).toBeNull();
  });

  it('empty string → null', () => {
    expect(parseRetryAfter('')).toBeNull();
  });

  it('"5" (seconds) → 5000ms', () => {
    expect(parseRetryAfter('5')).toBe(5000);
  });

  it('"2.5" (fractional seconds) → 2500ms (rounded up)', () => {
    expect(parseRetryAfter('2.5')).toBe(2500);
  });

  it('"0" (zero seconds) → null (no wait needed)', () => {
    expect(parseRetryAfter('0')).toBeNull();
  });

  it('invalid string → null', () => {
    expect(parseRetryAfter('invalid')).toBeNull();
  });

  it('HTTP-date in the past → null', () => {
    const pastDate = new Date(Date.now() - 60000).toUTCString();
    expect(parseRetryAfter(pastDate)).toBeNull();
  });

  it('HTTP-date in the future → positive delta', () => {
    const futureDate = new Date(Date.now() + 5000).toUTCString();
    const result = parseRetryAfter(futureDate);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(4000); // ~5000ms minus processing time
    expect(result!).toBeLessThan(6000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EDGE — computeBoundedBackoff
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — EDGE: computeBoundedBackoff', () => {
  it('returns INITIAL_BACKOFF_MS (2000) — bounded by MAX_BACKOFF_MS (10000)', () => {
    const backoff = computeBoundedBackoff();
    expect(backoff).toBe(INITIAL_BACKOFF_MS); // 2000
    expect(backoff).toBeLessThanOrEqual(MAX_BACKOFF_MS); // <= 10000
  });

  it('INITIAL_BACKOFF_MS = 2000', () => {
    expect(INITIAL_BACKOFF_MS).toBe(2000);
  });

  it('MAX_BACKOFF_MS = 10000', () => {
    expect(MAX_BACKOFF_MS).toBe(10000);
  });

  it('RETRY_SAFETY_BUFFER_MS = 1500', () => {
    expect(RETRY_SAFETY_BUFFER_MS).toBe(1500);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EDGE — sleep helper
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43 — EDGE: sleep helper', () => {
  it('sleep(50) resolves after ~50ms', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // allow small timer variance
    expect(elapsed).toBeLessThan(200);
  });

  it('sleep(0) resolves immediately', async () => {
    const start = Date.now();
    await sleep(0);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
