// Supabase client initialization
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Configuration depuis les variables d'environnement
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Vérification de la configuration
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('⚠️ Configuration Supabase manquante. Vérifiez les variables d\'environnement.');
}

// Create the Supabase client
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
