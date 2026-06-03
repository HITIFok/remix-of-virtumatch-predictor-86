// Supabase client initialization
// Importe la configuration centralisée depuis config/env.ts
import { createClient } from '@supabase/supabase-js';
import { DATABASE_URL, DATABASE_ANON_KEY } from '@/config/env';
import type { Database } from './types';

// Sécurité : vérifier que l'URL Supabase est configurée
if (!DATABASE_URL || !DATABASE_ANON_KEY) {
  console.error(
    '[SUPABASE] Configuration manquante !',
    'VITE_DATABASE_URL:', DATABASE_URL ? '✓' : '✗ MANQUANTE',
    'VITE_DATABASE_ANON_KEY:', DATABASE_ANON_KEY ? '✓' : '✗ MANQUANTE',
    '→ Vérifiez les variables d\'environnement Vercel (Settings > Environment Variables)'
  );
}

// Device ID helper — utilisé pour le header RLS x-device-id
function getDeviceIdForHeader(): string {
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

// Create the Supabase client with x-device-id header for RLS
export const supabase = createClient<Database>(DATABASE_URL, DATABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    headers: {
      // RLS "Read own predictions" policy requires this header
      'x-device-id': getDeviceIdForHeader(),
    },
  },
});
