// Vercel Serverless Function — Account Deletion (GDPR Article 17)
// POST /api/account-delete
// Body: { confirmation: "DELETE" }
// Headers: Authorization: Bearer <session_token>
//
// Performs cascading deletion of all user data:
//   1. predictions (device_id / user_id)
//   2. premium_activations (device_id / user_id)
//   3. access_codes (dereference used_by_device)
//   4. magic_links (email)
//   5. device_secrets (device_id)
//   6. users (parent table — last)
//
// Requires authenticated user session (Bearer token).
// Irreversible — all data is permanently deleted.

import { setCorsHeaders } from './_lib/cors.js';
import { createSql } from './_lib/db.js';
import { requireUserAuth } from './_lib/auth.js';
import { revokeDeviceTokens, revokeUserSessions } from './_lib/token-revocation.js';
import { createRateLimiter } from './_lib/ratelimit.js';
import { getClientIp } from './_lib/request.js';
import {
  errorResponse, methodNotAllowed, rateLimited,
  invalidInput, internalError, unauthorized, successResponse
} from './_lib/errors.js';
import { createLogger } from './_lib/logger.js';

const log = createLogger('account-delete');

// Strict rate limit: 3 deletion requests per hour per IP
const deleteLimiter = createRateLimiter('account-delete', { max: 3, windowMs: 60 * 60 * 1000 });

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end('');
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  // ── Rate limit ──
  const ip = getClientIp(req);
  if (!deleteLimiter.check(ip).allowed) {
    log.warn('Rate limited', { ip });
    return rateLimited(res, 3600);
  }

  // ── Authenticate via Bearer session token ──
  const userId = await requireUserAuth(req);
  if (!userId) {
    return unauthorized(res, 'Session authentifiée requise (Bearer token)');
  }

  // ── Parse body ──
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return invalidInput(res, 'JSON invalide');
  }

  // ── Require explicit confirmation ──
  if (body.confirmation !== 'DELETE') {
    return invalidInput(res, 'Confirmation requise: { confirmation: "DELETE" }', 'confirmation');
  }

  // ── Perform cascading deletion ──
  const sql = createSql();
  const deletionResults = {};

  try {
    // Look up user email and device_id for the cascade
    const [user] = await sql`SELECT email FROM users WHERE id = ${userId}`;
    if (!user) {
      await sql.end();
      return invalidInput(res, 'Utilisateur non trouvé');
    }
    const email = user.email;

    // Find device_id(s) associated with this user
    const devices = await sql`
      SELECT device_id FROM device_secrets
      WHERE device_id IN (
        SELECT DISTINCT device_id FROM predictions WHERE user_id = ${userId}
        UNION
        SELECT DISTINCT device_id FROM premium_activations WHERE user_id = ${userId}
      )
    `;
    const deviceIds = devices.map(d => d.device_id);

    // Step 1: Delete predictions
    const predResult = await sql`DELETE FROM predictions WHERE user_id = ${userId}`;
    deletionResults.predictions = Number(predResult.count);

    // Step 2: Delete premium activations
    const premResult = await sql`DELETE FROM premium_activations WHERE user_id = ${userId}`;
    deletionResults.premium_activations = Number(premResult.count);

    // Step 3: Dereference device from access codes
    for (const deviceId of deviceIds) {
      await sql`UPDATE access_codes SET used_by_device = NULL WHERE used_by_device = ${deviceId}`;
    }

    // Step 4: Delete magic links
    const magicResult = await sql`DELETE FROM magic_links WHERE email = ${email}`;
    deletionResults.magic_links = Number(magicResult.count);

    // Step 5: Delete device secrets (invalidates all HMAC tokens)
    for (const deviceId of deviceIds) {
      await sql`DELETE FROM device_secrets WHERE device_id = ${deviceId}`;
      // Revoke device tokens in blacklist
      revokeDeviceTokens(deviceId, 'USER_REQUEST');
    }

    // Step 6: Revoke all user sessions
    revokeUserSessions(userId, 'USER_REQUEST');

    // Step 7: Delete user record (parent table — last)
    await sql`DELETE FROM users WHERE id = ${userId}`;
    deletionResults.users = 1;

    await sql.end();

    log.info('Account deleted (GDPR Article 17)', {
      userId,
      devicesDeleted: deviceIds.length,
      predictionsDeleted: deletionResults.predictions,
    });

    return successResponse(res, {
      message: 'Compte supprimé définitivement. Toutes les données personnelles ont été effacées.',
      deleted: deletionResults,
      devicesRevoked: deviceIds.length,
    });
  } catch (err) {
    log.error('Account deletion failed', { userId }, { cause: err });
    try { await sql.end(); } catch { /* */ }
    return internalError(res, err, 'Erreur lors de la suppression du compte');
  }
}
