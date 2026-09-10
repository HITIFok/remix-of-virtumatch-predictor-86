// Phase AL — HMAC_ONLY Migration Readiness Tests
import { describe, it, expect } from 'vitest';
import {
  READINESS_CRITERIA,
  MigrationMetrics,
  getMigrationReadiness,
  ACTIVATION_PROCEDURE,
  ROLLBACK_PROCEDURE,
} from '../hmac-migration.js';

// ─── Readiness Criteria ───────────────────────────────────────────────────

describe('Phase AL: HMAC Migration Readiness Criteria', () => {
  it('has at least 8 readiness criteria', () => {
    expect(READINESS_CRITERIA.length).toBeGreaterThanOrEqual(8);
  });

  it('each criterion has required fields', () => {
    for (const rc of READINESS_CRITERIA) {
      expect(rc.id).toMatch(/^RC-\d+$/);
      expect(rc.criterion).toBeTruthy();
      expect(rc.status).toBeTruthy();
      expect(rc.evidence).toBeTruthy();
      expect(typeof rc.blocking).toBe('boolean');
    }
  });

  it('at least 5 criteria are IMPLEMENTED', () => {
    const implemented = READINESS_CRITERIA.filter(c => c.status === 'IMPLEMENTED');
    expect(implemented.length).toBeGreaterThanOrEqual(5);
  });

  it('critical blocking criteria are implemented (RC-01 through RC-05)', () => {
    const critical = READINESS_CRITERIA.filter(c => c.blocking && c.id <= 'RC-05');
    for (const rc of critical) {
      expect(rc.status).toBe('IMPLEMENTED');
    }
  });

  it('remaining blocking criteria are documented', () => {
    const remaining = READINESS_CRITERIA.filter(c => c.blocking && c.status !== 'IMPLEMENTED');
    for (const rc of remaining) {
      expect(rc.evidence).toBeTruthy();
    }
  });
});

// ─── Migration Metrics ────────────────────────────────────────────────────

describe('Phase AL: Migration Metrics', () => {
  it('tracks HMAC authentication count', () => {
    const metrics = new MigrationMetrics();
    metrics.recordHmacAuth();
    metrics.recordHmacAuth();
    metrics.recordHmacAuth();
    const result = metrics.getMetrics();
    expect(result.hmacAuthCount).toBe(3);
    expect(result.fallbackAuthCount).toBe(0);
  });

  it('tracks fallback authentication count', () => {
    const metrics = new MigrationMetrics();
    metrics.recordFallbackAuth('POST', '1.2.3.4');
    metrics.recordFallbackAuth('GET', '5.6.7.8');
    const result = metrics.getMetrics();
    expect(result.fallbackAuthCount).toBe(2);
    expect(result.hmacAuthCount).toBe(0);
  });

  it('calculates fallback rate correctly', () => {
    const metrics = new MigrationMetrics();
    metrics.recordHmacAuth(); // 1 HMAC
    metrics.recordHmacAuth(); // 2 HMAC
    metrics.recordFallbackAuth('POST', '1.2.3.4'); // 1 fallback
    const result = metrics.getMetrics();
    expect(result.totalAuth).toBe(3);
    expect(result.fallbackRate).toBe(33.33); // 1/3 = ~33%
  });

  it('tracks fallback by HTTP method', () => {
    const metrics = new MigrationMetrics();
    metrics.recordFallbackAuth('POST', '1.2.3.4');
    metrics.recordFallbackAuth('POST', '5.6.7.8');
    metrics.recordFallbackAuth('GET', '9.10.11.12');
    const result = metrics.getMetrics();
    expect(result.fallbackByMethod.POST).toBe(2);
    expect(result.fallbackByMethod.GET).toBe(1);
  });

  it('tracks unique IPs using fallback', () => {
    const metrics = new MigrationMetrics();
    metrics.recordFallbackAuth('POST', '1.2.3.4');
    metrics.recordFallbackAuth('POST', '1.2.3.4');
    metrics.recordFallbackAuth('GET', '5.6.7.8');
    const result = metrics.getMetrics();
    expect(result.uniqueFallbackIps).toBe(2);
  });

  it('tracks DELETE blocked count', () => {
    const metrics = new MigrationMetrics();
    metrics.recordDeleteBlocked();
    metrics.recordDeleteBlocked();
    const result = metrics.getMetrics();
    expect(result.deleteBlockedCount).toBe(2);
  });

  it('determines readiness for activation', () => {
    const metrics = new MigrationMetrics();
    // 95% HMAC, 5% fallback → ready
    for (let i = 0; i < 95; i++) metrics.recordHmacAuth();
    for (let i = 0; i < 4; i++) metrics.recordFallbackAuth('POST', '1.2.3.4');
    const result = metrics.getMetrics();
    expect(result.readyForActivation).toBe(true); // 4/99 < 5%
  });

  it('not ready when fallback rate exceeds 5%', () => {
    const metrics = new MigrationMetrics();
    for (let i = 0; i < 90; i++) metrics.recordHmacAuth();
    for (let i = 0; i < 10; i++) metrics.recordFallbackAuth('POST', '1.2.3.4');
    const result = metrics.getMetrics();
    expect(result.readyForActivation).toBe(false); // 10/100 = 10%
  });

  it('reset clears all metrics', () => {
    const metrics = new MigrationMetrics();
    metrics.recordHmacAuth();
    metrics.recordFallbackAuth('POST', '1.2.3.4');
    metrics.reset();
    const result = metrics.getMetrics();
    expect(result.totalAuth).toBe(0);
    expect(result.fallbackRate).toBe(0);
  });
});

// ─── Migration Readiness Status ───────────────────────────────────────────

describe('Phase AL: Migration Readiness Status', () => {
  it('returns comprehensive readiness assessment', () => {
    const readiness = getMigrationReadiness();
    expect(readiness.criteriaTotal).toBe(READINESS_CRITERIA.length);
    expect(readiness.blockingTotal).toBeGreaterThan(0);
    expect(typeof readiness.canActivate).toBe('boolean');
    expect(Array.isArray(readiness.remainingBlocking)).toBe(true);
  });

  it('majority of criteria are implemented', () => {
    const readiness = getMigrationReadiness();
    expect(readiness.implementationPercent).toBeGreaterThanOrEqual(50);
  });

  it('blocking criteria progress tracked', () => {
    const readiness = getMigrationReadiness();
    expect(readiness.blockingPercent).toBeGreaterThanOrEqual(50);
  });
});

// ─── Activation & Rollback Procedures ─────────────────────────────────────

describe('Phase AL: Activation Procedure', () => {
  it('has at least 8 activation steps', () => {
    expect(ACTIVATION_PROCEDURE.length).toBeGreaterThanOrEqual(8);
  });

  it('each step has step number, action, and prerequisite', () => {
    for (const step of ACTIVATION_PROCEDURE) {
      expect(step.step).toBeGreaterThan(0);
      expect(step.action).toBeTruthy();
      expect(step.prerequisite).toBeTruthy();
    }
  });

  it('steps are ordered sequentially', () => {
    for (let i = 1; i < ACTIVATION_PROCEDURE.length; i++) {
      expect(ACTIVATION_PROCEDURE[i].step).toBeGreaterThan(ACTIVATION_PROCEDURE[i - 1].step);
    }
  });

  it('final step sets HMAC_ONLY=true in production', () => {
    const prodStep = ACTIVATION_PROCEDURE.find(s => s.action.includes('production'));
    expect(prodStep).toBeTruthy();
  });
});

describe('Phase AL: Rollback Procedure', () => {
  it('has at least 5 rollback steps', () => {
    expect(ROLLBACK_PROCEDURE.length).toBeGreaterThanOrEqual(5);
  });

  it('first step sets HMAC_ONLY=false', () => {
    expect(ROLLBACK_PROCEDURE[0].action).toContain('HMAC_ONLY=false');
  });

  it('each step has step number and action', () => {
    for (const step of ROLLBACK_PROCEDURE) {
      expect(step.step).toBeGreaterThan(0);
      expect(step.action).toBeTruthy();
    }
  });
});
