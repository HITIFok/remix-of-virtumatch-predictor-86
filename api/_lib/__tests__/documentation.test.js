// Phase O — Documentation Tests
//
// Tests verify:
//   1. ADRs exist for key security decisions
//   2. Security runbook exists with incident response
//   3. Documentation is not empty / stub

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();

describe('Phase O: Architecture Decision Records', () => {

  const ADRS = [
    { file: 'docs/adr/001-hmac-device-auth.md', topic: 'HMAC' },
    { file: 'docs/adr/002-cors-allowlist.md', topic: 'CORS' },
    { file: 'docs/adr/003-csp-strict.md', topic: 'CSP' },
    { file: 'docs/adr/004-coefficient-registry.md', topic: 'coefficient' },
    { file: 'docs/adr/005-error-validation-modules.md', topic: 'validation' },
  ];

  for (const { file, topic } of ADRS) {
    it(`${file} exists and covers ${topic}`, () => {
      expect(existsSync(resolve(cwd, file))).toBe(true);
      const src = readFileSync(resolve(cwd, file), 'utf8');
      expect(src.length).toBeGreaterThan(200);
      expect(src.toLowerCase()).toContain(topic.toLowerCase());
    });
  }

  it('ADRs have consistent format (Status, Context, Decision, Consequences)', () => {
    for (const { file } of ADRS) {
      const src = readFileSync(resolve(cwd, file), 'utf8');
      expect(src).toContain('Status');
      expect(src).toContain('Context');
      expect(src).toContain('Decision');
      expect(src).toContain('Consequences');
    }
  });
});

describe('Phase O: Security runbook', () => {

  it('security-runbook.md exists', () => {
    expect(existsSync(resolve(cwd, 'docs/security-runbook.md'))).toBe(true);
  });

  it('includes incident response procedures', () => {
    const src = readFileSync(resolve(cwd, 'docs/security-runbook.md'), 'utf8');
    expect(src).toContain('Incident Response');
  });

  it('includes pre-deployment checklist', () => {
    const src = readFileSync(resolve(cwd, 'docs/security-runbook.md'), 'utf8');
    expect(src).toContain('Pre-Deployment');
  });

  it('documents key security files', () => {
    const src = readFileSync(resolve(cwd, 'docs/security-runbook.md'), 'utf8');
    expect(src).toContain('auth.js');
    expect(src).toContain('cors.js');
    expect(src).toContain('prediction-config.ts');
  });

  it('documents all test suites', () => {
    const src = readFileSync(resolve(cwd, 'docs/security-runbook.md'), 'utf8');
    expect(src).toContain('auth.test.js');
    expect(src).toContain('calibration.test.js');
    expect(src).toContain('ci-pipeline.test.js');
  });
});
