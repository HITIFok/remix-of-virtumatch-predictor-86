// Supabase client initialization
// Importe la configuration centralisée depuis config/env.ts
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/config/env';
import type { Database } from './types';

// Sécurité : vérifier que l'URL Supabase est configurée
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '[SUPABASE] Configuration manquante !',
    'VITE_SUPABASE_URL:', SUPABASE_URL ? '✓' : '✗ MANQUANTE',
    'VITE_SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? '✓' : '✗ MANQUANTE',
    '→ Vérifiez les variables d\'environnement Vercel (Settings > Environment Variables)'
  );
}

// Create the Supabase client
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
