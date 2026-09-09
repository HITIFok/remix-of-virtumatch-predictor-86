// Vercel Edge Middleware — Distributed Rate Limiting + CSP Nonce Generation
// Phase E: Upstash Redis rate limiting with in-memory fallback
//
// Architecture:
//   1. If UPSTASH_REDIS_REST_URL is configured → distributed Redis rate limit
//      (shared across all Vercel instances, survives cold starts)
//   2. If not configured → in-memory fallback (per-instance, resets on cold start)
//      (adequate for low traffic / development)
//
// Security: Rate limits are applied BEFORE auth checks (fail-fast on abuse).
// HMAC fallback requests (during V-01 migration) get a STRICTER limit.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ─── Rate Limit Configuration ────────────────────────────────────────────

const RATE_LIMIT_MAX = 30;           // 30 requests per minute per IP (standard)
const RATE_LIMIT_STRICT_MAX = 10;    // 10 req/min for HMAC fallback (migration monitoring)
const RATE_LIMIT_WINDOW = '1 m';     // 1 minute sliding window

// ─── Distributed Rate Limiter (Upstash Redis) ────────────────────────────

let ratelimit = null;
let ratelimitStrict = null;

function initDistributedRateLimit() {
  if (ratelimit) return true; // Already initialized

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) return false; // Not configured

  try {
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });

    ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW),
      prefix: 'virtumatch:rl',
      analytics: true, // Enable Upstash analytics dashboard
    });

    ratelimitStrict = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_STRICT_MAX, RATE_LIMIT_WINDOW),
      prefix: 'virtumatch:rl-strict',
      analytics: true,
    });

    return true;
  } catch (err) {
    console.error('[middleware] Upstash init failed, falling back to in-memory:', err.message);
    return false;
  }
}

// ─── In-Memory Fallback Rate Limiter ─────────────────────────────────────

const inMemoryStore = new Map();
const IN_MEMORY_WINDOW_MS = 60 * 1000;

function checkInMemoryRateLimit(ip, maxRequests = RATE_LIMIT_MAX) {
  const now = Date.now();
  const windowKey = Math.floor(now / IN_MEMORY_WINDOW_MS);
  const key = `${ip}:${windowKey}`;

  const current = inMemoryStore.get(key) || 0;

  if (current >= maxRequests) {
    return {
      success: false,
      limit: maxRequests,
      remaining: 0,
      reset: (windowKey + 1) * IN_MEMORY_WINDOW_MS,
    };
  }

  inMemoryStore.set(key, current + 1);

  // Periodic cleanup to prevent memory leak
  if (inMemoryStore.size > 10000) {
    const currentWindow = Math.floor(now / IN_MEMORY_WINDOW_MS);
    for (const [k] of inMemoryStore) {
      const parts = k.split(':');
      const entryWindow = parseInt(parts[parts.length - 1], 10);
      if (entryWindow < currentWindow - 1) {
        inMemoryStore.delete(k);
      }
    }
  }

  return {
    success: true,
    limit: maxRequests,
    remaining: maxRequests - current - 1,
    reset: (windowKey + 1) * IN_MEMORY_WINDOW_MS,
  };
}

// ─── Unified Rate Limit Check ────────────────────────────────────────────

/**
 * Check rate limit for a given identifier.
 * Uses distributed Redis if configured, in-memory otherwise.
 *
 * @param {string} ip - Client IP address
 * @param {boolean} strict - Use stricter limit (for HMAC fallback during migration)
 * @returns {Promise<{success: boolean, limit: number, remaining: number, reset: number}>}
 */
async function checkRateLimit(ip, strict = false) {
  // Try distributed first
  if (initDistributedRateLimit()) {
    try {
      const limiter = strict ? ratelimitStrict : ratelimit;
      const result = await limiter.limit(ip);
      return {
        success: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
      };
    } catch (err) {
      // Redis error → fall back to in-memory (graceful degradation)
      console.error('[middleware] Redis rate limit error, using in-memory fallback:', err.message);
    }
  }

  // In-memory fallback
  const maxRequests = strict ? RATE_LIMIT_STRICT_MAX : RATE_LIMIT_MAX;
  return checkInMemoryRateLimit(ip, maxRequests);
}

// ─── Middleware Entry Point ───────────────────────────────────────────────

export async function middleware(request) {
  const { pathname } = new URL(request.url);

  // Only rate-limit API routes
  if (!pathname.startsWith('/api/')) return undefined;

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';

  // V-01 migration: stricter rate limit for HMAC fallback requests
  // (requests without Authorization: Device <token> header)
  const authHeader = request.headers.get('authorization') || '';
  const hasHmacToken = authHeader.startsWith('Device ');
  const strict = !hasHmacToken; // Stricter limit for plain x-device-id fallback

  const result = await checkRateLimit(ip, strict);

  if (!result.success) {
    const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
    return new Response(
      JSON.stringify({ error: 'Trop de requêtes. Réessayez dans une minute.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': String(result.remaining),
          'X-RateLimit-Reset': String(result.reset),
        },
      }
    );
  }

  // Request allowed — pass through
  return undefined;
}

export const config = {
  matcher: '/api/:path*',
};
