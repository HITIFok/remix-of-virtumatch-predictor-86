// Vercel Edge Middleware - Rate limiting for API routes
// Simple in-memory rate limiter using Vercel KV-compatible approach

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute per IP

// In-memory store (resets per cold start, acceptable for single-instance)
const rateLimitStore = new Map();

function getRateLimitKey(ip) {
  return `${ip}:${Math.floor(Date.now() / RATE_LIMIT_WINDOW)}`;
}

function checkRateLimit(ip) {
  const key = getRateLimitKey(ip);
  const current = rateLimitStore.get(key) || 0;
  
  if (current >= RATE_LIMIT_MAX) {
    return false;
  }
  
  rateLimitStore.set(key, current + 1);
  
  // Cleanup old entries periodically
  if (rateLimitStore.size > 10000) {
    const windowKey = Math.floor(Date.now() / RATE_LIMIT_WINDOW);
    for (const [k] of rateLimitStore) {
      const entryWindow = parseInt(k.split(':')[1]);
      if (entryWindow < windowKey - 1) {
        rateLimitStore.delete(k);
      }
    }
  }
  
  return true;
}

export function middleware(request) {
  const { pathname } = request.nextUrl;
  
  // Only rate limit API routes
  if (pathname.startsWith('/api/')) {
    // Vercel edge middleware doesn't have direct access to IP,
    // but the x-forwarded-for header is available
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
    
    if (!checkRateLimit(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
          },
        }
      );
    }
  }
  
  return Response.next();
}

export const config = {
  matcher: '/api/:path*',
};
