// Vercel Serverless Function — Data Retention Cleanup
// Phase P4 — Cron job for GDPR-compliant data retention enforcement.
// Removes expired magic_links (30-day TTL) and old predictions (365-day TTL).
//
// Called by Vercel cron: 0 3 * * * (daily at 3 AM UTC)
// Can also be called manually with CRON_SECRET for verification.

import { setCorsHeaders } from './_lib/cors.js';
import { createSql, NEON_DATABASE_URL } from './_lib/db.js';
import { errorResponse, methodNotAllowed, unauthorized, internalError, successResponse } from './_lib/errors.js';
import { createLogger } from './_lib/logger.js';

const log = createLogger('data-cleanup');

const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end('');
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  // ── Authenticate cron call ──
  const authHeader = req.headers['authorization'] || '';
  const providedSecret = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (CRON_SECRET && providedSecret !== CRON_SECRET) {
    log.warn('Unauthorized cleanup attempt');
    return unauthorized(res, 'CRON_SECRET required');
  }

  if (!NEON_DATABASE_URL) {
    return internalError(res, null, 'Database not configured');
  }

  const sql = createSql();
  const results = {};

  try {
    // ── CLEANUP-01: Expired magic links (30-day retention) ──
    const magicResult = await sql`
      DELETE FROM magic_links
      WHERE created_at < NOW() - INTERVAL '30 days'
    `;
    results.magic_links_deleted = Number(magicResult.count);

    // ── CLEANUP-02: Old predictions (365-day retention) ──
    const predResult = await sql`
      DELETE FROM predictions
      WHERE created_at < NOW() - INTERVAL '365 days'
    `;
    results.predictions_deleted = Number(predResult.count);

    // ── CLEANUP-03: Expired premium activations (cleanup) ──
    const premResult = await sql`
      DELETE FROM premium_activations
      WHERE expires_at < NOW() - INTERVAL '90 days'
    `;
    results.expired_premium_deleted = Number(premResult.count);

    await sql.end();

    log.info('Data retention cleanup completed', results);

    return successResponse(res, {
      message: 'Data retention cleanup completed',
      ...results,
    });
  } catch (err) {
    log.error('Data cleanup failed', undefined, { cause: err });
    try { await sql.end(); } catch { /* */ }
    return internalError(res, err, 'Data cleanup failed');
  }
}
