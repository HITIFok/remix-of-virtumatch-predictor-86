// Vercel Edge Middleware - Rate limiting for API routes
// Compatible Vercel Edge Runtime (Vite/non-Next.js)
// CORRECTIF : suppression de request.nextUrl (API Next.js) et Response.next() (Next.js only)
//
// LIMITE : le store in-memory se réinitialise par cold start et n'est pas partagé
// entre instances serverless parallèles. Suffisant pour un trafic modéré.
// Pour une protection robuste, migrer vers @upstash/ratelimit (voir commentaire en bas).

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30;              // 30 requêtes par minute par IP

// Store in-memory (par instance, réinitialisé au cold start)
const rateLimitStore = new Map();

function getRateLimitKey(ip) {
  // Fenêtre glissante basée sur la minute courante
  return `${ip}:${Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS)}`;
}

function checkRateLimit(ip) {
  const key = getRateLimitKey(ip);
  const current = rateLimitStore.get(key) || 0;

  if (current >= RATE_LIMIT_MAX) {
    return false;
  }

  rateLimitStore.set(key, current + 1);

  // Nettoyage périodique des entrées périmées
  if (rateLimitStore.size > 10000) {
    const currentWindow = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
    for (const [k] of rateLimitStore) {
      const parts = k.split(':');
      const entryWindow = parseInt(parts[parts.length - 1], 10);
      if (entryWindow < currentWindow - 1) {
        rateLimitStore.delete(k);
      }
    }
  }

  return true;
}

export function middleware(request) {
  // CORRECTIF : utiliser new URL(request.url) au lieu de request.nextUrl (Next.js only)
  const { pathname } = new URL(request.url);

  // Limiter uniquement les routes API
  if (pathname.startsWith('/api/')) {
    const forwarded = request.headers.get('x-forwarded-for');
    // Prendre la première IP de la chaîne (la plus proche du client)
    const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';

    if (!checkRateLimit(ip)) {
      return new Response(
        JSON.stringify({ error: 'Trop de requêtes. Réessayez dans une minute.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
            'X-RateLimit-Window': '60',
          },
        }
      );
    }
  }

  // CORRECTIF : ne pas retourner Response.next() (API Next.js)
  // En Vercel Edge Middleware non-Next, retourner undefined laisse passer la requête.
  return undefined;
}

export const config = {
  matcher: '/api/:path*',
};

// ─────────────────────────────────────────────────────────────────
// MIGRATION RECOMMANDÉE : rate limiting distribué avec Upstash Redis
// ─────────────────────────────────────────────────────────────────
// Si le trafic augmente ou si plusieurs régions Vercel sont actives,
// le store in-memory devient insuffisant. Migration en 3 étapes :
//
// 1. Créer une base Redis gratuite sur https://upstash.com
//
// 2. Installer le SDK :
//    npm install @upstash/ratelimit @upstash/redis
//
// 3. Remplacer ce fichier par :
//
// import { Ratelimit } from '@upstash/ratelimit';
// import { Redis } from '@upstash/redis';
//
// const ratelimit = new Ratelimit({
//   redis: Redis.fromEnv(),           // UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN dans Vercel env
//   limiter: Ratelimit.slidingWindow(30, '1 m'),
//   analytics: true,
// });
//
// export async function middleware(request) {
//   const { pathname } = new URL(request.url);
//   if (!pathname.startsWith('/api/')) return undefined;
//
//   const forwarded = request.headers.get('x-forwarded-for');
//   const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
//
//   const { success, limit, remaining, reset } = await ratelimit.limit(ip);
//   if (!success) {
//     return new Response(JSON.stringify({ error: 'Trop de requêtes.' }), {
//       status: 429,
//       headers: {
//         'Content-Type': 'application/json',
//         'X-RateLimit-Limit': String(limit),
//         'X-RateLimit-Remaining': String(remaining),
//         'X-RateLimit-Reset': String(reset),
//         'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
//       },
//     });
//   }
//   return undefined;
// }
//
// export const config = { matcher: '/api/:path*' };
