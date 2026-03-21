// Supabase client initialization - Hardcoded for APK build
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Hardcoded credentials for APK build (no environment variables needed)
const DATABASE_URL = 'REDACTED_DATABASE_URL';
const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4bW1lZW16a2l4aW5zeGdsZmFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MDUzNTUsImV4cCI6MjA4ODk4MTM1NX0.5MEMH8RS6HX3CJfAJATilNlz_hVrBeOdSjeur-wmr9E';

// Create the Supabase client
export const supabase = createClient<Database>(DATABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
