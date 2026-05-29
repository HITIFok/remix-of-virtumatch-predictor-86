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

// Create the Supabase client
export const supabase = createClient<Database>(DATABASE_URL, DATABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
