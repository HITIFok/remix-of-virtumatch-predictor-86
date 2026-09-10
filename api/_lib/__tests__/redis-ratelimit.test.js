// Phase X — Redis Rate Limiting Tests
// Verifies dual-mode rate limiter (Redis + in-memory fallback)

import { describe, it, expect, vi } from 'vitest';
import { createRateLimiter, getRateLimiterStats, isRedisActive } from '../ratelimit.js';

describe('Phase X: Redis Rate Limiting', () => {

  describe('in-memory mode (no Redis env vars)', () => {
    it('isRedisActive returns false without env vars', () => {
      expect(isRedisActive()).toBe(false);
    });

    it('check() works synchronously in-memory', () => {
      const limiter = createRateLimiter('test-x', { max: 2, windowMs: 60000 });
      const r1 = limiter.check('key1');
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(1);

      const r2 = limiter.check('key1');
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(0);

      const r3 = limiter.check('key1');
      expect(r3.allowed).toBe(false);
      expect(r3.retryAfter).toBe(60);
    });

    it('checkDistributed() falls back to in-memory when no Redis', async () => {
      const limiter = createRateLimiter('test-x-dist', { max: 3, windowMs: 60000 });
      const r1 = await limiter.checkDistributed('key2');
      expect(r1.allowed).toBe(true);
    });
  });

  describe('dual-mode architecture', () => {
    it('createRateLimiter returns object with check + checkDistributed + reset', () => {
      const limiter = createRateLimiter('test-arch', { max: 10, windowMs: 60000 });
      expect(typeof limiter.check).toBe('function');
      expect(typeof limiter.checkDistributed).toBe('function');
      expect(typeof limiter.reset).toBe('function');
    });

    it('getRateLimiterStats includes mode field', () => {
      createRateLimiter('test-stats-x', { max: 5, windowMs: 30000 });
      const stats = getRateLimiterStats();
      expect(stats['test-stats-x']).toBeDefined();
      expect(stats['test-stats-x'].mode).toBe('in-memory');
    });
  });

  describe('Redis graceful degradation', () => {
    it('checkDistributed degrades to in-memory on Redis failure', async () => {
      // Even if Redis env vars are not set, checkDistributed should work
      const limiter = createRateLimiter('test-degrade', { max: 5, windowMs: 60000 });
      const result = await limiter.checkDistributed('degrade-key');
      expect(result.allowed).toBe(true);
      expect(result).toHaveProperty('remaining');
      expect(result).toHaveProperty('retryAfter');
    });
  });

  describe('per-limiter isolation', () => {
    it('different limiters have independent counters', () => {
      const limiterA = createRateLimiter('iso-a', { max: 1, windowMs: 60000 });
      const limiterB = createRateLimiter('iso-b', { max: 1, windowMs: 60000 });

      const rA1 = limiterA.check('same-key');
      const rB1 = limiterB.check('same-key');

      expect(rA1.allowed).toBe(true);
      expect(rB1.allowed).toBe(true);

      const rA2 = limiterA.check('same-key');
      expect(rA2.allowed).toBe(false);
    });
  });

  describe('reset functionality', () => {
    it('reset() allows requests again after being limited', () => {
      const limiter = createRateLimiter('test-reset-x', { max: 1, windowMs: 60000 });
      limiter.check('reset-key');
      const r = limiter.check('reset-key');
      expect(r.allowed).toBe(false);

      limiter.reset('reset-key');
      const rAfter = limiter.check('reset-key');
      expect(rAfter.allowed).toBe(true);
    });
  });

});
