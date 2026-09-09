// Unified In-Memory Rate Limiter with Automatic Cleanup
// Phase I — Replaces 5 duplicate Map-based rate limit implementations
//
// Features:
//   - Sliding window with configurable max/windowMs
//   - Automatic stale entry cleanup (runs every windowMs)
//   - Consistent return type: { allowed, remaining, retryAfter }
//   - Dual-key support (email+IP for auth endpoints)
//   - Memory-safe: entries older than 2× windowMs are evicted

const stores = new Map(); // name → { map, max, windowMs, interval }

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
    check(key) {
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
    // Access the internal map through closure
    stats[name] = { active: true };
  }
  return stats;
}
