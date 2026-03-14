// Supabase client initialization with error handling
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Debug: Log environment status
if (typeof window !== 'undefined') {
  console.log('Supabase Config:', {
    hasUrl: !!SUPABASE_URL,
    hasKey: !!SUPABASE_PUBLISHABLE_KEY,
    urlPrefix: SUPABASE_URL?.substring(0, 30) + '...',
  });
}

// Validate environment variables
let supabaseInstance: ReturnType<typeof createClient<Database>>;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error('❌ Missing Supabase environment variables!');
  console.error('VITE_SUPABASE_URL:', SUPABASE_URL || 'NOT SET');
  console.error('VITE_SUPABASE_PUBLISHABLE_KEY:', SUPABASE_PUBLISHABLE_KEY ? 'SET (hidden)' : 'NOT SET');
  
  // Show error to user
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        padding: 20px;
        background: #fee2e2;
        color: #dc2626;
        font-family: sans-serif;
        text-align: center;
        z-index: 9999;
        border-bottom: 2px solid #dc2626;
      `;
      errorDiv.innerHTML = `
        <strong>⚠️ Erreur de configuration</strong><br>
        <small>Variables d'environnement Supabase manquantes.<br>
        Vérifiez la configuration dans Vercel.</small>
      `;
      document.body.appendChild(errorDiv);
    }, 100);
  }
  
  // Create a dummy client that won't crash the app
  supabaseInstance = createClient('https://placeholder.supabase.co', 'placeholder-key') as any;
} else {
  // Create the real client
  supabaseInstance = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    }
  });
}

export const supabase = supabaseInstance;
