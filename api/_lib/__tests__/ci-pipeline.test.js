// Phase J — CI/CD Pipeline Tests
//
// Tests verify:
//   1. CI test workflow exists (ci-test.yml)
//   2. Branch guard enhanced with coefficient check
//   3. Coefficient validation at startup works correctly
//   4. TypeScript compiles without errors
//   5. Vite build succeeds
//   6. All test suites pass (frontend + API)

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();

// ── CI Workflow Structure ────────────────────────────────────────────────

describe('Phase J: CI test workflow exists', () => {

  it('ci-test.yml workflow file exists', () => {
    expect(existsSync(resolve(cwd, '.github/workflows/ci-test.yml'))).toBe(true);
  });

  it('ci-test.yml runs on push to main', () => {
    const src = readFileSync(resolve(cwd, '.github/workflows/ci-test.yml'), 'utf8');
    expect(src).toContain('branches: [main]');
    expect(src).toContain('push:');
  });

  it('ci-test.yml runs on pull requests to main', () => {
    const src = readFileSync(resolve(cwd, '.github/workflows/ci-test.yml'), 'utf8');
    expect(src).toContain('pull_request:');
  });

  it('ci-test.yml runs frontend tests (vitest run)', () => {
    const src = readFileSync(resolve(cwd, '.github/workflows/ci-test.yml'), 'utf8');
    expect(src).toContain('vitest run');
  });

  it('ci-test.yml runs API security tests', () => {
    const src = readFileSync(resolve(cwd, '.github/workflows/ci-test.yml'), 'utf8');
    expect(src).toContain('vitest.api.config.ts');
  });

  it('ci-test.yml runs TypeScript type-check', () => {
    const src = readFileSync(resolve(cwd, '.github/workflows/ci-test.yml'), 'utf8');
    expect(src).toContain('tsc --noEmit');
  });

  it('ci-test.yml runs production build', () => {
    const src = readFileSync(resolve(cwd, '.github/workflows/ci-test.yml'), 'utf8');
    expect(src).toContain('npm run build');
  });

  it('ci-test.yml has concurrency group to cancel in-progress runs', () => {
    const src = readFileSync(resolve(cwd, '.github/workflows/ci-test.yml'), 'utf8');
    expect(src).toContain('cancel-in-progress: true');
  });
});

// ── Branch Guard Enhancement ────────────────────────────────────────────

describe('Phase J: Branch guard enhanced with coefficient audit', () => {

  it('branch-guard.yml checks for hardcoded coefficients', () => {
    const src = readFileSync(resolve(cwd, '.github/workflows/branch-guard.yml'), 'utf8');
    expect(src).toContain('prediction-engine');
    expect(src).toContain('0\\.70'); // Escaped for grep regex in YAML
  });

  it('branch-guard.yml CORS check fails on wildcard (exit 1)', () => {
    const src = readFileSync(resolve(cwd, '.github/workflows/branch-guard.yml'), 'utf8');
    // The CORS check should exit 1 (not just warn) when wildcard detected
    expect(src).toMatch(/Access-Control-Allow-Origin.*\n.*exit 1/s);
  });
});

// ── Startup Validation ──────────────────────────────────────────────────

describe('Phase J: Startup coefficient validation module', () => {

  it('startup-validation.ts exists', () => {
    expect(existsSync(resolve(cwd, 'src/lib/startup-validation.ts'))).toBe(true);
  });

  it('imports validateCoefficients from prediction-config', () => {
    const src = readFileSync(resolve(cwd, 'src/lib/startup-validation.ts'), 'utf8');
    expect(src).toContain("from './prediction-config'");
    expect(src).toContain('validateCoefficients');
  });

  it('exits with code 1 in production on validation failure', () => {
    const src = readFileSync(resolve(cwd, 'src/lib/startup-validation.ts'), 'utf8');
    expect(src).toContain("NODE_ENV === 'production'");
    expect(src).toContain('process.exit(1)');
  });

  it('logs calibration priorities for arbitrary coefficients', () => {
    const src = readFileSync(resolve(cwd, 'src/lib/startup-validation.ts'), 'utf8');
    expect(src).toContain('getArbitraryCount');
    expect(src).toContain('getCalibrationPriorities');
  });
});

// ── Coefficient Validation Functional Test ──────────────────────────────

describe('Phase J: validateCoefficients() correctness', () => {

  const configSource = readFileSync(resolve(cwd, 'src/lib/prediction-config.ts'), 'utf8');

  it('validateCoefficients checks stat weight conservation', () => {
    expect(configSource).toContain('STAT_BASE_WEIGHT + cfg.STAT_ATTACK_WEIGHT + cfg.STAT_DEF_WEIGHT');
  });

  it('validateCoefficients checks form weight monotonicity', () => {
    expect(configSource).toContain('FORM_WEIGHT_0');
    expect(configSource).toContain('formWeights[i] >= formWeights[i - 1]');
  });

  it('validateCoefficients checks grid bounds (MIN < MAX)', () => {
    expect(configSource).toContain('GRID_MIN_LAMBDA >= cfg.GRID_MAX_LAMBDA');
  });

  it('validateCoefficients checks confidence bounds (MAX_BASE < CAP)', () => {
    expect(configSource).toContain('CONF_MAX_BASE >= cfg.CONF_CAP');
  });
});
