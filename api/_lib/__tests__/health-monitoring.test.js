// Phase S — Health Check & Monitoring Tests
//
// Tests verify:
//   1. Health check action exists in verify-predictions.js (GET ?action=health)
//   2. Health check returns proper structure
//   3. Coefficient validation at startup
//   4. Memory usage tracking
//   5. DB connectivity check (when configured)

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();

// Health check is now merged into verify-predictions.js as GET ?action=health
const healthSource = readFileSync(resolve(cwd, 'api/verify-predictions.js'), 'utf8');

// ── Health Endpoint Structure ────────────────────────────────────────────

describe('Phase S: /api/health endpoint (via verify-predictions.js)', () => {

  it('health action exists in verify-predictions.js', () => {
    expect(healthSource).toContain('health');
    expect(healthSource).toContain('handleHealthCheck');
  });

  it('standalone health.js no longer exists', () => {
    expect(existsSync(resolve(cwd, 'api/health.js'))).toBe(false);
  });

  it('returns 200 for healthy, 503 for degraded', () => {
    expect(healthSource).toContain('200');
    expect(healthSource).toContain('503');
    expect(healthSource).toContain("'healthy'");
    expect(healthSource).toContain("'degraded'");
  });

  it('includes timestamp in ISO format', () => {
    expect(healthSource).toContain('toISOString()');
  });

  it('includes node version', () => {
    expect(healthSource).toContain('process.version');
  });

  it('includes environment (VERCEL_ENV or NODE_ENV)', () => {
    expect(healthSource).toContain('VERCEL_ENV');
    expect(healthSource).toContain('NODE_ENV');
  });

  it('uses setCorsHeaders for CORS', () => {
    expect(healthSource).toContain("from './_lib/cors.js'");
    expect(healthSource).toContain('setCorsHeaders');
  });
});

// ── Database Check ───────────────────────────────────────────────────────

describe('Phase S: Database connectivity check', () => {

  it('checks DB when NEON_DATABASE_URL is configured', () => {
    expect(healthSource).toContain('NEON_DATABASE_URL');
    expect(healthSource).toContain('SELECT 1');
  });

  it('marks status as degraded if DB fails', () => {
    expect(healthSource).toContain("'degraded'");
  });

  it('handles missing DB gracefully (not_configured)', () => {
    expect(healthSource).toContain("'not_configured'");
  });

  it('reports DB latency', () => {
    expect(healthSource).toContain('latency_ms');
  });
});

// ── Coefficient Validation Check ─────────────────────────────────────────

describe('Phase S: Coefficient validation in health check', () => {

  it('imports validateCoefficients', () => {
    expect(healthSource).toContain('validateCoefficients');
  });

  it('imports getArbitraryCount', () => {
    expect(healthSource).toContain('getArbitraryCount');
  });

  it('reports arbitrary count', () => {
    expect(healthSource).toContain('arbitraryCount');
  });

  it('reports validation errors/warnings count', () => {
    expect(healthSource).toContain('errors');
    expect(healthSource).toContain('warnings');
  });

  it('marks degraded if coefficients invalid', () => {
    expect(healthSource).toMatch(/!result\.valid.*degraded/);
  });
});

// ── Memory Usage Tracking ────────────────────────────────────────────────

describe('Phase S: Memory usage tracking', () => {

  it('includes process.memoryUsage()', () => {
    expect(healthSource).toContain('process.memoryUsage()');
  });

  it('reports heap used/total and RSS', () => {
    expect(healthSource).toContain('heapUsed');
    expect(healthSource).toContain('heapTotal');
    expect(healthSource).toContain('rss');
  });

  it('reports in MB (rounded)', () => {
    expect(healthSource).toContain('1024');
    expect(healthSource).toContain('Math.round');
  });
});

// ── Startup Validation Module ────────────────────────────────────────────

describe('Phase S: Startup validation module', () => {

  it('startup-validation.ts exists', () => {
    expect(existsSync(resolve(cwd, 'src/lib/startup-validation.ts'))).toBe(true);
  });

  const startupSrc = readFileSync(resolve(cwd, 'src/lib/startup-validation.ts'), 'utf8');

  it('calls validateCoefficients() at startup', () => {
    expect(startupSrc).toContain('validateCoefficients()');
  });

  it('exits with process.exit(1) on production failure', () => {
    expect(startupSrc).toContain('process.exit(1)');
    expect(startupSrc).toContain("'production'");
  });

  it('logs arbitrary coefficients needing calibration', () => {
    expect(startupSrc).toContain('getArbitraryCount');
    expect(startupSrc).toContain('getCalibrationPriorities');
  });
});
