// Supabase client initialization
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Configuration depuis les variables d'environnement
const DATABASE_URL = import.meta.env.VITE_DATABASE_URL || '';
const DATABASE_ANON_KEY = import.meta.env.VITE_DATABASE_ANON_KEY || '';

// Vérification de la configuration
if (!DATABASE_URL || !DATABASE_ANON_KEY) {
  console.warn('⚠️ Configuration Supabase manquante. Vérifiez les variables d\'environnement.');
}

// Create the Supabase client
export const supabase = createClient<Database>(DATABASE_URL, DATABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
