// Unified Rate Limiter with Automatic Cleanup
// Phase I → Phase X: Dual-mode (Redis when available, in-memory fallback)
//
// Features:
//   - Sliding window with configurable max/windowMs
//   - Automatic stale entry cleanup (runs every windowMs)
//   - Consistent return type: { allowed, remaining, retryAfter }
//   - Dual-key support (email+IP for auth endpoints)
//   - Memory-safe: entries older than 2× windowMs are evicted
//   - Phase X: Upstash Redis when UPSTASH_REDIS_REST_URL is configured

const stores = new Map(); // name → { map, max, windowMs, interval }

// ── Redis Detection ────────────────────────────────────────────────────
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_REDIS = !!(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);

let _redis = null;
let _ratelimit = null;

async function getRedisRateLimiter() {
  if (_ratelimit) return _ratelimit;
  if (!USE_REDIS) return null;
  try {
    const { Ratelimit } = await import('@upstash/ratelimit');
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({
      url: UPSTASH_REDIS_REST_URL,
      token: UPSTASH_REDIS_REST_TOKEN,
    });
    _ratelimit = new Ratelimit({
      redis: _redis,
      limiter: Ratelimit.slidingWindow(30, '1 m'), // default, overridden per-limiter
    });
    return _ratelimit;
  } catch (err) {
    console.error('[ratelimit] Redis init failed, falling back to in-memory:', err.message);
    return null;
  }
}

/**
 * Create or get a named rate limiter.
 *
 * @param {string} name - Unique name for this rate limiter (e.g., 'predictions', 'auth-email')
 * @param {object} options
 * @param {number} options.max - Max requests per window
 * @param {number} options.windowMs - Window duration in milliseconds
 * @returns {{ check: (key: string) => { allowed: boolean, remaining: number, retryAfter: number } }}
 */
export function createRateLimiter(name, { max, windowMs }) {
  if (stores.has(name)) return stores.get(name);

  const map = new Map();

  // Periodic cleanup: evict stale entries every windowMs
  // This prevents unbounded memory growth in warm serverless containers
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of map) {
      if (now - entry.firstAttempt > windowMs * 2) {
        map.delete(k);
      }
    }
  }, windowMs);

  // Don't prevent process exit
  if (interval.unref) interval.unref();

  const limiter = {
    // Synchronous check (in-memory only — used by handlers)
    check(key) {
      // ── In-memory path ──
      const now = Date.now();
      const windowKey = Math.floor(now / windowMs);
      const fullKey = `${key}:${windowKey}`;

      const entry = map.get(fullKey);
      const current = entry ? entry.count : 0;

      if (current >= max) {
        const retryAfter = Math.ceil(windowMs / 1000);
        return { allowed: false, remaining: 0, retryAfter };
      }

      // Increment or create entry
      if (entry) {
        entry.count++;
      } else {
        map.set(fullKey, { count: 1, firstAttempt: now });
      }

      return { allowed: true, remaining: max - current - 1, retryAfter: 0 };
    },

    // Async check with Redis support (when UPSTASH_REDIS_REST_URL is set)
    async checkDistributed(key) {
      if (USE_REDIS) {
        try {
          const { Ratelimit } = await import('@upstash/ratelimit');
          const { Redis } = await import('@upstash/redis');

          if (!limiter._redisLimiter) {
            const redis = new Redis({
              url: UPSTASH_REDIS_REST_URL,
              token: UPSTASH_REDIS_REST_TOKEN,
            });
            const windowSec = Math.ceil(windowMs / 1000);
            limiter._redisLimiter = new Ratelimit({
              redis,
              limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
              prefix: `virtumatch:${name}`,
            });
          }

          const result = await limiter._redisLimiter.limit(key);
          return {
            allowed: result.success,
            remaining: result.remaining,
            retryAfter: result.success ? 0 : Math.ceil(windowMs / 1000),
          };
        } catch (err) {
          // Redis failed → fall back to in-memory (graceful degradation)
          console.error(`[ratelimit:${name}] Redis error, falling back:`, err.message);
        }
      }

      // In-memory fallback
      return limiter.check(key);
    },

    // Reset a key (e.g., on successful auth)
    reset(key) {
      const now = Date.now();
      const windowKey = Math.floor(now / windowMs);
      const fullKey = `${key}:${windowKey}`;
      map.delete(fullKey);
    },
  };

  stores.set(name, limiter);
  return limiter;
}

/**
 * Get all active rate limiter stores (for monitoring/debugging).
 */
export function getRateLimiterStats() {
  const stats = {};
  for (const [name, limiter] of stores) {
    stats[name] = { active: true, mode: USE_REDIS ? 'redis' : 'in-memory' };
  }
  return stats;
}

/**
 * Check if Redis rate limiting is active.
 */
export function isRedisActive() {
  return USE_REDIS;
}
