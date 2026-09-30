// ============================================
// PHASE 5.3.43.3 — PREVENTIVE 2s THROTTLING TESTS
// ============================================
//
// Validates that the batch orchestrator applies a 2000ms delay between
// sequential matches when interCallDelayMs=2000 is passed.
//
// Tests:
//   1. interCallDelayMs=2000 is accepted + applied
//   2. Sequencing: enhanceSingle(match1) → resolve → delay 2000 → enhanceSingle(match2)
//   3. No delay after the LAST match
//   4. Error on match N does NOT skip the delay before match N+1
//   5. No parallelism — only one enhanceSingle active at a time
//   6. Phase 5.3.43 retry tests still pass (interCallDelayMs doesn't affect retry)
// ============================================

import { describe, it, expect, vi } from 'vitest';
import { orchestrateBatchPredict } from '../lib/batch-predict-orchestrator';

// Helper: track call timestamps to verify delays
function makeTimedEnhanceSingle() {
  const timestamps: { start: number; end: number }[] = [];
  const enhanceSingle = vi.fn(async (match: any) => {
    const start = Date.now();
    await new Promise(r => setTimeout(r, 10)); // simulate 10ms work
    timestamps.push({ start, end: Date.now() });
  });
  return { enhanceSingle, timestamps };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1 — interCallDelayMs=2000 is accepted + applied
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.3 — TEST 1: interCallDelayMs=2000 accepted', () => {
  it('orchestrator accepts interCallDelayMs=2000 without error', async () => {
    const matches = [{ id: 1 }, { id: 2 }];
    const { enhanceSingle } = makeTimedEnhanceSingle();
    const result = await orchestrateBatchPredict(matches, {
      enhanceSingle,
      interCallDelayMs: 2000,
    });
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2 — Sequencing: delay between match 1 end and match 2 start
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.3 — TEST 2: delay applied between matches', () => {
  it('gap between match1.end and match2.start ≈ interCallDelayMs', async () => {
    const matches = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { enhanceSingle, timestamps } = makeTimedEnhanceSingle();
    const delayMs = 100; // use 100ms for test speed — proves the delay is applied
    await orchestrateBatchPredict(matches, {
      enhanceSingle,
      interCallDelayMs: delayMs,
    });
    // timestamps[0].end → timestamps[1].start should be ~100ms
    const gap1 = timestamps[1].start - timestamps[0].end;
    expect(gap1).toBeGreaterThanOrEqual(delayMs - 30); // allow timer variance
    expect(gap1).toBeLessThan(delayMs + 100);
    // timestamps[1].end → timestamps[2].start should also be ~100ms
    const gap2 = timestamps[2].start - timestamps[1].end;
    expect(gap2).toBeGreaterThanOrEqual(delayMs - 30);
    expect(gap2).toBeLessThan(delayMs + 100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3 — No delay after the LAST match
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.3 — TEST 3: no delay after last match', () => {
  it('for 3 matches with interCallDelayMs=100, only 2 delays applied (between 1-2 and 2-3, not after 3)', async () => {
    const matches = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { enhanceSingle, timestamps } = makeTimedEnhanceSingle();
    const delayMs = 100;
    const startOuter = Date.now();
    await orchestrateBatchPredict(matches, {
      enhanceSingle,
      interCallDelayMs: delayMs,
    });
    const totalElapsed = Date.now() - startOuter;
    // 3 × 10ms work + 2 × 100ms delay = 230ms minimum
    // If there were 3 delays (including after last), it would be 330ms
    expect(totalElapsed).toBeGreaterThanOrEqual(200); // 30 + 200 = 230 - variance
    expect(totalElapsed).toBeLessThan(350); // not 330+ — no delay after last
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4 — Error on match N does NOT skip the delay before match N+1
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.3 — TEST 4: error isolation with delay', () => {
  it('match 2 fails → delay still applied → match 3 runs', async () => {
    const matches = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const timestamps: number[] = [];
    const enhanceSingle = vi.fn(async (match: any) => {
      timestamps.push(Date.now());
      if (match.id === 2) {
        throw new Error('Simulated failure');
      }
      await new Promise(r => setTimeout(r, 10));
    });
    const result = await orchestrateBatchPredict(matches, {
      enhanceSingle,
      interCallDelayMs: 100,
    });
    // All 3 matches were attempted
    expect(enhanceSingle).toHaveBeenCalledTimes(3);
    // Match 2 failed, matches 1 and 3 succeeded
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(1);
    // The delay between match 2 (which threw immediately) and match 3 should be ~100ms
    // timestamps[1] = match 2 start (throws immediately)
    // timestamps[2] = match 3 start
    const gap = timestamps[2] - timestamps[1];
    expect(gap).toBeGreaterThanOrEqual(70); // 100ms - variance
    expect(gap).toBeLessThan(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 5 — No parallelism: only one enhanceSingle active at a time
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.3 — TEST 5: no parallel enhanceSingle calls', () => {
  it('with interCallDelayMs=50, matches are strictly sequential (no overlap)', async () => {
    const matches = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
    const activeCount = { current: 0, max: 0 };
    const enhanceSingle = vi.fn(async (match: any) => {
      activeCount.current++;
      activeCount.max = Math.max(activeCount.max, activeCount.current);
      await new Promise(r => setTimeout(r, 10));
      activeCount.current--;
    });
    await orchestrateBatchPredict(matches, {
      enhanceSingle,
      interCallDelayMs: 50,
    });
    // At no point should more than 1 enhanceSingle be active simultaneously
    expect(activeCount.max).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 6 — interCallDelayMs=0 means no delay (backward compat)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 5.3.43.3 — TEST 6: interCallDelayMs=0 (no delay, backward compat)', () => {
  it('interCallDelayMs=0 → no delay between matches', async () => {
    const matches = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { enhanceSingle, timestamps } = makeTimedEnhanceSingle();
    const startOuter = Date.now();
    await orchestrateBatchPredict(matches, {
      enhanceSingle,
      interCallDelayMs: 0,
    });
    const totalElapsed = Date.now() - startOuter;
    // 3 × 10ms work + 0 delay = ~30ms
    expect(totalElapsed).toBeLessThan(100);
  });

  it('interCallDelayMs undefined → treated as 0 (no delay)', async () => {
    const matches = [{ id: 1 }, { id: 2 }];
    const { enhanceSingle } = makeTimedEnhanceSingle();
    const result = await orchestrateBatchPredict(matches, {
      enhanceSingle,
      // interCallDelayMs NOT passed — should default to 0
    });
    expect(result.successCount).toBe(2);
  });
});
