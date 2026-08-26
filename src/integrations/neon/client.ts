// Neon PostgreSQL client initialization (migrated from Supabase)
// Uses @neondatabase/serverless for browser/edge compatibility (HTTP+WebSocket)
// NOT postgres (Node.js only — doesn't work in Vite browser builds)
import { neon } from '@neondatabase/serverless';
import { NEON_DATABASE_URL } from '@/config/env';

// Device ID helper — used for business logic tracking
export function getDeviceIdForHeader(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      let id = localStorage.getItem("virtuxxs_device_id");
      if (!id) {
        id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem("virtuxxs_device_id", id);
      }
      return id;
    }
  } catch { /* SSR or localStorage unavailable */ }
  return 'unknown';
}

// Security: check that the Neon URL is configured
if (!NEON_DATABASE_URL) {
  console.error(
    '[NEON] Configuration manquante !',
    'VITE_NEON_DATABASE_URL:', NEON_DATABASE_URL ? '✓' : '✗ MANQUANTE',
    '→ Vérifiez les variables d\'environnement Vercel (Settings > Environment Variables)'
  );
}

// Create the Neon serverless SQL tagged template
// Works in browser via HTTP, in edge/server via WebSocket
export const sql = neon(NEON_DATABASE_URL);
