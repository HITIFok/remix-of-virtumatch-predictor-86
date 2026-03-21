// Supabase client initialization - Hardcoded for APK build
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Hardcoded credentials for APK build (no environment variables needed)
const DATABASE_URL = 'https://gxmmeemzkixinsxglfaq.redacted.example.com';
const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4bW1lZW16a2l4aW5zeGdsZmFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA4NDc2MTMsImV4cCI6MjA1NjQyMzYxM30.yDCnFK7lAQ5XyjqPfDVNzLEyp1zAJHm3nKFNCH5-WHQ';

// Create the Supabase client
export const supabase = createClient<Database>(DATABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
