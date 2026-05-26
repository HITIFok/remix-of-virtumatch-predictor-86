// Supabase client initialization
// Importe la configuration centralisée depuis config/env.ts
import { createClient } from '@supabase/supabase-js';
import { DATABASE_URL, DATABASE_ANON_KEY } from '@/config/env';
import type { Database } from './types';

// Create the Supabase client
export const supabase = createClient<Database>(DATABASE_URL, DATABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
