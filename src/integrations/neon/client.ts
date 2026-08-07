// Neon PostgreSQL client initialization (migrated from Supabase)
import postgres from 'postgres';
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

// Create the postgres.js SQL instance
export const sql = postgres(NEON_DATABASE_URL, {
  prepare: true,
});
