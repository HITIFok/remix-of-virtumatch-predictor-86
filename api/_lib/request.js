// Shared Request Utilities
// Phase I — Centralizes IP extraction and common request helpers

/**
 * Extract client IP from request headers.
 * Uses x-forwarded-for (Vercel sets this from the actual client IP).
 * Falls back to 'unknown' if not available.
 *
 * Note (V-05): The first IP in x-forwarded-for is the most trustworthy
 * when behind Vercel's proxy, as Vercel prepends the real client IP.
 * However, if behind additional proxies, this could be spoofed.
 * For maximum security, Vercel Edge config should validate the IP.
 *
 * @param {object} req - Vercel Serverless Function request
 * @returns {string} Client IP address
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = forwarded.split(',')[0].trim();
    if (ip) return ip;
  }
  // Fallback: Vercel sets req.headers['x-real-ip'] in some configs
  const realIp = req.headers['x-real-ip'];
  if (realIp) return realIp.trim();
  return 'unknown';
}
