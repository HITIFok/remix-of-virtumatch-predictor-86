// Vercel Serverless Function — Device Registration for HMAC Auth
// Called once per device to obtain a per-device secret.
// The client stores this secret in IndexedDB/localStorage and uses it
// to sign all subsequent API requests.

import { setCorsHeaders } from './_lib/cors.js';
import { registerDevice, DEVICE_ID_RE } from './_lib/auth.js';
import { createRateLimiter } from './_lib/ratelimit.js';
import { getClientIp } from './_lib/request.js';
import { errorResponse, successResponse, methodNotAllowed, rateLimited, invalidInput, internalError } from './_lib/errors.js';
import { validateDeviceId } from './_lib/validate.js';
import { createLogger } from './_lib/logger.js';

const log = createLogger('device-register');

// Rate limit: 5 registrations per IP per minute (prevents secret enumeration)
// Phase I: shared rate limiter with automatic cleanup
const registerLimiter = createRateLimiter('device-register', { max: 5, windowMs: 60 * 1000 });

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type, x-device-id');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  // Rate limit
  const ip = getClientIp(req);
  const rl = registerLimiter.check(ip);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    log.warn('Rate limited', { ip, retryAfter: rl.retryAfter });
    return rateLimited(res, rl.retryAfter);
  }

  // Extract device_id from header (primary) or body (fallback)
  let deviceId = req.headers['x-device-id'] || '';

  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      deviceId = String(body.device_id || '').trim();
    } catch { /* ignore */ }
  }

  // Phase M: validate with shared module
  const validatedId = validateDeviceId(deviceId);
  if (!validatedId) {
    log.warn('Invalid device_id', { deviceId: deviceId ? 'invalid-format' : 'missing' });
    return invalidInput(res, 'Valid device_id required (x-device-id header or body.device_id)', 'device_id');
  }
  deviceId = validatedId;

  const result = await registerDevice(deviceId);

  if (result.alreadyRegistered) {
    log.info('Device already registered', { deviceId });
    return errorResponse(res, 409, 'Device already registered', {
      code: 'ALREADY_EXISTS',
      meta: { alreadyRegistered: true },
    });
  }

  if (!result.success) {
    log.error('Registration failed', { deviceId });
    return internalError(res, new Error('registerDevice failed'));
  }

  log.info('Device registered', { deviceId });
  return successResponse(res, { device_secret: result.device_secret });
}
