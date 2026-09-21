// Vercel Serverless Function — Refresh Token
// Phase AQ (P7) — Allows active sessions to refresh their token before expiry.
// This extends the session without requiring re-authentication via magic link,
// reducing friction for active users while maintaining 7-day maximum session life.
//
// POST /api/refresh-token
// Headers: Authorization: Bearer <current_session_token>
// Response: { token: "<new_token>", expiresIn: 604800 }
//
// Security properties:
//   - Only valid, non-expired, non-revoked tokens can be refreshed
//   - The old token is automatically revoked after refresh (single-use rotation)
//   - Rate limited: 10 refreshes per hour per user
//   - Refresh does not extend beyond 7 days from refresh time

import { setCorsHeaders } from './_lib/cors.js';
import { requireUserAuth, signUserToken } from './_lib/auth.js';
import { revokeToken } from './_lib/token-revocation.js';
import { createRateLimiter } from './_lib/ratelimit.js';
import { getClientIp } from './_lib/request.js';
import {
  methodNotAllowed, rateLimited, unauthorized,
  internalError, successResponse
} from './_lib/errors.js';
import { createLogger } from './_lib/logger.js';
import { captureException } from './_lib/sentry.js';

const log = createLogger('refresh-token');

// Rate limit: 10 refreshes per hour per IP
const refreshLimiter = createRateLimiter('refresh-token', { max: 10, windowMs: 60 * 60 * 1000 });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end('');
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  // ── Rate limit ──
  const ip = getClientIp(req);
  if (!refreshLimiter.check(ip).allowed) {
    log.warn('Rate limited', { ip });
    return rateLimited(res, 3600);
  }

  // ── Authenticate with current session token ──
  const authHeader = req.headers['authorization'] || '';
  const currentToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  const userId = await requireUserAuth(req);
  if (!userId) {
    return unauthorized(res, 'Session authentifiée requise (Bearer token)');
  }

  // ── Rotate token ──
  try {
    // 1. Revoke the old token (single-use rotation — prevents replay)
    revokeToken(currentToken, 'TOKEN_REFRESH');

    // 2. Issue a new token
    const newToken = signUserToken(userId);

    // 3. Log the refresh event
    log.info('Token refreshed', { userId });

    return successResponse(res, {
      token: newToken,
      expiresIn: Math.floor(SEVEN_DAYS_MS / 1000), // 604800 seconds
      message: 'Token refreshed successfully',
    });
  } catch (err) {
    log.error('Token refresh failed', { userId }, { cause: err });
    captureException(err, { module: 'refresh-token' });
    return internalError(res, err, 'Erreur lors du rafraîchissement du token');
  }
}
