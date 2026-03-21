// Configuration de l'application
// Ce fichier contient les variables d'environnement injectées au build
// Les valeurs sont remplacées par les GitHub Secrets lors du build CI

export const config = {
  // Configuration Supabase
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL || '',
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  },
  
  // API endpoints
  api: {
    fetchLiveUrl: import.meta.env.VITE_SUPABASE_URL 
      ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-live`
      : '',
  },
} as const;

// Export individuels pour faciliter l'import
export const SUPABASE_URL = config.supabase.url;
export const SUPABASE_ANON_KEY = config.supabase.anonKey;
