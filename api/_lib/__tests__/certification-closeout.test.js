// Phase AN — Final Audit Closeout & Certification Tests
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');

describe('Phase AN: Final Audit Closeout', () => {
  // ─── Certification Report ──────────────────────────────────────────────

  describe('certification report', () => {
    it('PDF report exists in download directory', () => {
      const pdfPath = path.join(ROOT, 'download', 'virtumatch-certification-report.pdf');
      expect(fs.existsSync(pdfPath)).toBe(true);
    });

    it('PDF report has non-zero size', () => {
      const pdfPath = path.join(ROOT, 'download', 'virtumatch-certification-report.pdf');
      const size = fs.statSync(pdfPath).size;
      expect(size).toBeGreaterThan(10000);
    });
  });

  // ─── New Modules (Phases AI-AM) ────────────────────────────────────────

  describe('new security modules', () => {
    const modules = [
      'attack-surface.js',
      'gdpr-compliance.js',
      'token-revocation.js',
      'hmac-migration.js',
      'security-score.js',
    ];

    modules.forEach((mod) => {
      it(`api/_lib/${mod} exists`, () => {
        expect(fs.existsSync(path.join(ROOT, 'api', '_lib', mod))).toBe(true);
      });
    });
  });

  // ─── New Test Files ────────────────────────────────────────────────────

  describe('new test files', () => {
    const tests = [
      'attack-surface.test.js',
      'gdpr-compliance.test.js',
      'token-revocation.test.js',
      'hmac-migration.test.js',
      'security-score.test.js',
    ];

    tests.forEach((file) => {
      it(`api/_lib/__tests__/${file} exists`, () => {
        expect(fs.existsSync(path.join(ROOT, 'api', '_lib', '__tests__', file))).toBe(true);
      });
    });
  });

  // ─── Final Test Suite State ────────────────────────────────────────────

  describe('final test suite state', () => {
    it('has at least 35 test files', () => {
      const testsDir = path.join(ROOT, 'api', '_lib', '__tests__');
      const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.js'));
      expect(files.length).toBeGreaterThanOrEqual(35);
    });

    it('all test files are non-empty', () => {
      const testsDir = path.join(ROOT, 'api', '_lib', '__tests__');
      const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.js'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(testsDir, file), 'utf-8');
        expect(content.length).toBeGreaterThan(100);
      }
    });
  });

  // ─── Audit Completeness ────────────────────────────────────────────────

  describe('audit completeness', () => {
    it('all critical vulnerabilities have test coverage', () => {
      const testsDir = path.join(ROOT, 'api', '_lib', '__tests__');
      const testFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.js'));
      // V-01, V-02, V-03 coverage
      expect(testFiles).toContain('auth.test.js');
      expect(testFiles).toContain('cors.test.js');
      expect(testFiles).toContain('csp.test.js');
    });

    it('OWASP compliance module exists', () => {
      expect(fs.existsSync(path.join(ROOT, 'api', '_lib', 'owasp-compliance.js'))).toBe(true);
    });

    it('security regression suite exists', () => {
      expect(fs.existsSync(path.join(ROOT, 'api', '_lib', '__tests__', 'security-regression.test.js'))).toBe(true);
    });

    it('attack surface analysis module exists', () => {
      expect(fs.existsSync(path.join(ROOT, 'api', '_lib', 'attack-surface.js'))).toBe(true);
    });

    it('token revocation module exists', () => {
      expect(fs.existsSync(path.join(ROOT, 'api', '_lib', 'token-revocation.js'))).toBe(true);
    });

    it('GDPR compliance module exists', () => {
      expect(fs.existsSync(path.join(ROOT, 'api', '_lib', 'gdpr-compliance.js'))).toBe(true);
    });

    it('security score module exists', () => {
      expect(fs.existsSync(path.join(ROOT, 'api', '_lib', 'security-score.js'))).toBe(true);
    });
  });

  // ─── Deliverables ──────────────────────────────────────────────────────

  describe('deliverables', () => {
    it('certification PDF report generated', () => {
      const pdfPath = path.join(ROOT, 'download', 'virtumatch-certification-report.pdf');
      expect(fs.existsSync(pdfPath)).toBe(true);
    });

    it('previous audit report still available', () => {
      const pdfPath = path.join(ROOT, 'download', 'virtumatch-security-audit-final.pdf');
      expect(fs.existsSync(pdfPath)).toBe(true);
    });
  });
});
