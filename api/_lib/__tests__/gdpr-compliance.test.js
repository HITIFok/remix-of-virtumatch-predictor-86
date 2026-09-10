// Phase AJ — GDPR Compliance & Account Deletion Tests
import { describe, it, expect } from 'vitest';
import {
  DATA_SUBJECT_RIGHTS,
  DELETION_CASCADE,
  RETENTION_CLEANUP_JOBS,
  LEGAL_BASIS,
  getGdprComplianceStatus,
  getGdprGaps,
  generateDeletionSQL,
  verifyDeletionCompleteness,
} from '../gdpr-compliance.js';

// ─── Data Subject Rights ──────────────────────────────────────────────────

describe('Phase AJ: GDPR Data Subject Rights', () => {
  it('documents all 7 GDPR data subject rights', () => {
    expect(DATA_SUBJECT_RIGHTS.length).toBe(7);
  });

  it('each right has a valid GDPR article number', () => {
    const validArticles = [15, 16, 17, 18, 20, 21, 22];
    for (const right of DATA_SUBJECT_RIGHTS) {
      expect(validArticles).toContain(right.article);
    }
  });

  it('each right has required fields', () => {
    for (const right of DATA_SUBJECT_RIGHTS) {
      expect(right.article).toBeGreaterThan(0);
      expect(right.right).toBeTruthy();
      expect(right.description).toBeTruthy();
      expect(typeof right.implemented).toBe('boolean');
      expect(right.endpoint).toBeTruthy();
    }
  });

  it('Article 17 (Erasure) is documented', () => {
    const erasure = DATA_SUBJECT_RIGHTS.find(r => r.article === 17);
    expect(erasure).toBeTruthy();
    expect(erasure.right).toBe('Erasure');
  });

  it('at least 2 rights are implemented', () => {
    const implemented = DATA_SUBJECT_RIGHTS.filter(r => r.implemented);
    expect(implemented.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Deletion Cascade ─────────────────────────────────────────────────────

describe('Phase AJ: Account Deletion Cascade', () => {
  it('has deletion steps for all PII tables', () => {
    expect(DELETION_CASCADE.length).toBeGreaterThanOrEqual(6);
  });

  it('steps are ordered (referencing tables first)', () => {
    const steps = DELETION_CASCADE.map(s => s.step);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });

  it('each step has required fields', () => {
    for (const step of DELETION_CASCADE) {
      expect(step.step).toBeGreaterThan(0);
      expect(step.table).toBeTruthy();
      expect(step.operation).toBeTruthy();
      expect(step.piiColumns.length).toBeGreaterThan(0);
      expect(typeof step.canAutoDelete).toBe('boolean');
      expect(step.note).toBeTruthy();
    }
  });

  it('users table is deleted last (parent table)', () => {
    const lastStep = DELETION_CASCADE[DELETION_CASCADE.length - 1];
    expect(lastStep.table).toBe('users');
  });

  it('device_secrets is deleted before users', () => {
    const deviceIdx = DELETION_CASCADE.findIndex(s => s.table === 'device_secrets');
    const userIdx = DELETION_CASCADE.findIndex(s => s.table === 'users');
    expect(deviceIdx).toBeLessThan(userIdx);
  });

  it('all steps can be auto-deleted', () => {
    for (const step of DELETION_CASCADE) {
      expect(step.canAutoDelete).toBe(true);
    }
  });

  it('covers all PII tables from data-classification', () => {
    const tables = new Set(DELETION_CASCADE.map(s => s.table));
    expect(tables.has('users')).toBe(true);
    expect(tables.has('device_secrets')).toBe(true);
    expect(tables.has('magic_links')).toBe(true);
    expect(tables.has('predictions')).toBe(true);
    expect(tables.has('premium_activations')).toBe(true);
    expect(tables.has('access_codes')).toBe(true);
  });
});

// ─── Retention Cleanup ────────────────────────────────────────────────────

describe('Phase AJ: Data Retention Cleanup', () => {
  it('has cleanup jobs for time-limited data', () => {
    expect(RETENTION_CLEANUP_JOBS.length).toBeGreaterThanOrEqual(2);
  });

  it('each cleanup job has valid cron schedule', () => {
    for (const job of RETENTION_CLEANUP_JOBS) {
      expect(job.id).toMatch(/^CLEANUP-\d+$/);
      expect(job.table).toBeTruthy();
      expect(job.operation).toBeTruthy();
      expect(job.schedule).toBeTruthy();
      expect(job.retentionDays).toBeGreaterThan(0);
      expect(job.piiImpact).toBeTruthy();
    }
  });

  it('magic_links cleanup targets 30-day retention', () => {
    const job = RETENTION_CLEANUP_JOBS.find(j => j.table === 'magic_links');
    expect(job).toBeTruthy();
    expect(job.retentionDays).toBe(30);
  });

  it('predictions cleanup targets 365-day retention', () => {
    const job = RETENTION_CLEANUP_JOBS.find(j => j.table === 'predictions');
    expect(job).toBeTruthy();
    expect(job.retentionDays).toBe(365);
  });
});

// ─── GDPR Compliance Status ──────────────────────────────────────────────

describe('Phase AJ: GDPR Compliance Assessment', () => {
  it('returns comprehensive compliance status', () => {
    const status = getGdprComplianceStatus();
    expect(status.dataSubjectRights).toBeTruthy();
    expect(status.erasure).toBeTruthy();
    expect(status.retention).toBeTruthy();
    expect(typeof status.overallCompliant).toBe('boolean');
    expect(Array.isArray(status.gaps)).toBe(true);
  });

  it('identifies compliance gaps correctly', () => {
    const gaps = getGdprGaps();
    expect(gaps.length).toBeGreaterThanOrEqual(3); // At least Erasure + endpoint + cleanup
  });

  it('erasure endpoint gap is identified', () => {
    const gaps = getGdprGaps();
    const endpointGap = gaps.find(g => g.type === 'ENDPOINT');
    expect(endpointGap).toBeTruthy();
    expect(endpointGap.severity).toBe('HIGH');
  });

  it('retention cleanup gaps are identified', () => {
    const gaps = getGdprGaps();
    const retentionGaps = gaps.filter(g => g.type === 'RETENTION');
    expect(retentionGaps.length).toBeGreaterThanOrEqual(2);
  });

  it('not yet fully compliant (endpoint not implemented)', () => {
    const status = getGdprComplianceStatus();
    expect(status.overallCompliant).toBe(false);
  });
});

// ─── Deletion SQL Generation ──────────────────────────────────────────────

describe('Phase AJ: Deletion SQL Generation', () => {
  it('generates deletion statements for all cascade steps', () => {
    const result = generateDeletionSQL('dev-abc12345', 'user-uuid-123', 'user@example.com');
    expect(result.steps).toBe(DELETION_CASCADE.length);
    expect(result.statements.length).toBe(DELETION_CASCADE.length);
  });

  it('redacts email in output', () => {
    const result = generateDeletionSQL('dev-abc12345', 'user-uuid-123', 'user@example.com');
    expect(result.email).not.toBe('user@example.com');
    expect(result.email).toContain('***');
  });

  it('includes warning about permanent deletion', () => {
    const result = generateDeletionSQL('dev-abc12345', 'user-uuid-123', 'user@example.com');
    expect(result.warning).toContain('permanently');
  });

  it('verifies deletion completeness', () => {
    const result = verifyDeletionCompleteness();
    expect(result.complete).toBe(true);
    expect(result.cascadeCoverage).toBeGreaterThanOrEqual(6);
  });
});
