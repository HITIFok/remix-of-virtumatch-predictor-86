// ============================================
// PHASE 5.3.43.7 — FRONTEND RATE-LIMIT RETRY TESTS
// ============================================

import { describe, it, expect } from 'vitest';
import {
  shouldFrontendRetry,
  MAX_FRONTEND_RATE_LIMIT_RETRIES,
  MAX_FRONTEND_RETRY_AFTER_MS,
} from '../lib/frontend-retry-helper';
import { orchestrateBatchPredict } from '../lib/batch-predict-orchestrator';
import { shouldBlockPredict } from '../lib/predict-guard';

// ═══════════════════════════════════════════════════════════════════
// TEST 1 — 200 PARSE_OK → no retry
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — TEST 1: 200 OK → no retry', () => {
  it('rateLimited=false → shouldRetry=false', () => {
    const d = shouldFrontendRetry(false, null, 0);
    expect(d.shouldRetry).toBe(false);
    expect(d.waitMs).toBe(0);
    expect(d.source).toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2 — 429 Retry-After 2s → frontend waits → retry → PARSE_OK
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — TEST 2: 429 + Retry-After 2s → retry', () => {
  it('rateLimited=true + retryAfterMs=2000 + retryCount=0 → shouldRetry=true, waitMs=2000', () => {
    const d = shouldFrontendRetry(true, 2000, 0);
    expect(d.shouldRetry).toBe(true);
    expect(d.waitMs).toBe(2000);
    expect(d.source).toBe('retry-after');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3 — 429 Retry-After 15s → API returns quickly → frontend waits → retry
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — TEST 3: 429 + Retry-After 15s → retry (within cap)', () => {
  it('rateLimited=true + retryAfterMs=15000 + retryCount=0 → shouldRetry=true, waitMs=15000', () => {
    const d = shouldFrontendRetry(true, 15000, 0);
    expect(d.shouldRetry).toBe(true);
    expect(d.waitMs).toBe(15000);
    expect(d.source).toBe('retry-after');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4 — 429 → retry → 429 → RATE_LIMIT final
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — TEST 4: second 429 → no more retries', () => {
  it('rateLimited=true + retryCount=1 (MAX) → shouldRetry=false', () => {
    const d = shouldFrontendRetry(true, 2000, 1);
    expect(d.shouldRetry).toBe(false);
    expect(d.waitMs).toBe(0);
    expect(d.source).toBe('none');
  });

  it('MAX_FRONTEND_RATE_LIMIT_RETRIES = 1', () => {
    expect(MAX_FRONTEND_RATE_LIMIT_RETRIES).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════
// TEST 5 — 429 without Retry-After → deterministic bounded backoff
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — TEST 5: 429 without Retry-After → bounded backoff', () => {
  it('rateLimited=true + retryAfterMs=null → shouldRetry=true, waitMs=2000, source=bounded-backoff', () => {
    const d = shouldFrontendRetry(true, null, 0);
    expect(d.shouldRetry).toBe(true);
    expect(d.waitMs).toBe(2000);
    expect(d.source).toBe('bounded-backoff');
  });

  it('rateLimited=true + retryAfterMs=0 → shouldRetry=true, waitMs=2000 (fallback)', () => {
    const d = shouldFrontendRetry(true, 0, 0);
    expect(d.shouldRetry).toBe(true);
    expect(d.waitMs).toBe(2000);
    expect(d.source).toBe('bounded-backoff');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 6 — 429 HTTP-date → conversion correct (via retryAfterMs already parsed)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — TEST 6: HTTP-date conversion (already parsed to ms by API)', () => {
  // The API parses Retry-After (seconds or HTTP-date) and returns retryAfterMs.
  // The frontend receives the already-parsed value. This test verifies the
  // frontend correctly uses the parsed value regardless of original format.
  it('retryAfterMs from HTTP-date (e.g., 5000ms) → shouldRetry=true, waitMs=5000', () => {
    const d = shouldFrontendRetry(true, 5000, 0);
    expect(d.shouldRetry).toBe(true);
    expect(d.waitMs).toBe(5000);
    expect(d.source).toBe('retry-after');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 7 — Batch 3 matches → sequential order preserved
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — TEST 7: batch sequential order with retries', () => {
  it('3 matches processed sequentially (with interCallDelayMs)', async () => {
    
    const order: number[] = [];
    const result = await orchestrateBatchPredict(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      {
        enhanceSingle: async (m: any) => {
          order.push(m.id);
          await new Promise(r => setTimeout(r, 10));
        },
        interCallDelayMs: 50,
      },
    );
    expect(order).toEqual([1, 2, 3]);
    expect(result.successCount).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 8 — No Promise.all for AI calls in batch
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — TEST 8: no parallel AI calls', () => {
  it('at most 1 enhanceSingle active at a time', async () => {
    
    let active = 0;
    let maxActive = 0;
    await orchestrateBatchPredict(
      Array.from({ length: 5 }, (_, i) => ({ id: i })),
      {
        enhanceSingle: async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise(r => setTimeout(r, 10));
          active--;
        },
        interCallDelayMs: 5,
      },
    );
    expect(maxActive).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 9 — Batch + individual protection (concurrency guard)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — TEST 9: batch + individual protection', () => {
  it('shouldBlockPredict returns true when batchPredicting=true', () => {
    
    expect(shouldBlockPredict({
      predicting: false,
      predictionsLoading: false,
      oddHome: 2.0,
      batchPredicting: true,
    })).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 10 — Retry doesn't create two simultaneous calls for same match
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — TEST 10: retry is sequential (no double call)', () => {
  it('shouldFrontendRetry with retryCount=0 → retry → retryCount=1 → no more retry', () => {
    // First call: 429 → shouldFrontendRetry(true, 2000, 0) → shouldRetry=true
    const first = shouldFrontendRetry(true, 2000, 0);
    expect(first.shouldRetry).toBe(true);

    // After retry: 429 again → shouldFrontendRetry(true, 2000, 1) → shouldRetry=false
    const second = shouldFrontendRetry(true, 2000, 1);
    expect(second.shouldRetry).toBe(false);
  });

  it('MAX_FRONTEND_RETRY_AFTER_MS = 30000', () => {
    expect(MAX_FRONTEND_RETRY_AFTER_MS).toBe(30000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EDGE — Retry-After too large (> 30s cap)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.7 — EDGE: Retry-After > 30s cap → no retry', () => {
  it('retryAfterMs=60000 (> 30000 cap) → shouldRetry=false', () => {
    const d = shouldFrontendRetry(true, 60000, 0);
    expect(d.shouldRetry).toBe(false);
    expect(d.waitMs).toBe(0);
    expect(d.source).toBe('none');
  });

  it('retryAfterMs=31000 (> 30000 cap) → shouldRetry=false', () => {
    const d = shouldFrontendRetry(true, 31000, 0);
    expect(d.shouldRetry).toBe(false);
  });

  it('retryAfterMs=30000 (exactly at cap) → shouldRetry=true', () => {
    const d = shouldFrontendRetry(true, 30000, 0);
    expect(d.shouldRetry).toBe(true);
    expect(d.waitMs).toBe(30000);
  });
});
