// Vercel Serverless Function — Health Check
// Phase S — Monitoring endpoint for uptime checks and deployment verification
// Returns: service status, coefficient validation, DB connectivity, version

import { setCorsHeaders } from './_lib/cors.js';
import { createSql, NEON_DATABASE_URL } from './_lib/db.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, OPTIONS', '');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const startTime = Date.now();
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    node: process.version,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    checks: {},
  };

  // ── Database connectivity ───────────────────────────────────────────────
  if (NEON_DATABASE_URL) {
    try {
      const sql = createSql();
      const result = await sql`SELECT 1 as ok`;
      await sql.end();
      checks.checks.database = { status: 'ok', latency_ms: Date.now() - startTime };
    } catch (err) {
      checks.checks.database = { status: 'error', message: 'Connection failed' };
      checks.status = 'degraded';
    }
  } else {
    checks.checks.database = { status: 'not_configured' };
  }

  // ── Coefficient validation ───────────────────────────────────────────────
  try {
    // Dynamic import for TypeScript module
    const { validateCoefficients, getArbitraryCount } = await import('../src/lib/prediction-config.ts');
    const result = validateCoefficients();
    checks.checks.coefficients = {
      status: result.valid ? 'ok' : 'invalid',
      arbitraryCount: getArbitraryCount(),
      errors: result.errors.length,
      warnings: result.warnings.length,
    };
    if (!result.valid) checks.status = 'degraded';
  } catch {
    // TypeScript import may fail in pure Node.js — that's OK for health check
    checks.checks.coefficients = { status: 'not_checkable' };
  }

  // ── Memory usage ────────────────────────────────────────────────────────
  const mem = process.memoryUsage();
  checks.checks.memory = {
    heapUsed_mb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal_mb: Math.round(mem.heapTotal / 1024 / 1024),
    rss_mb: Math.round(mem.rss / 1024 / 1024),
  };

  // ── Uptime ──────────────────────────────────────────────────────────────
  checks.uptime_seconds = Math.round(process.uptime());

  const statusCode = checks.status === 'healthy' ? 200 : 503;
  return res.status(statusCode).json(checks);
}
