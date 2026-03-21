// Configuration de l'application
// Ce fichier contient les variables d'environnement injectées au build
// Les valeurs sont remplacées par les GitHub Secrets lors du build CI

export const config = {
  // Configuration Supabase
  supabase: {
    url: import.meta.env.VITE_DATABASE_URL || '',
    anonKey: import.meta.env.VITE_DATABASE_ANON_KEY || '',
  },
  
  // API endpoints
  api: {
    fetchLiveUrl: import.meta.env.VITE_DATABASE_URL 
      ? `${import.meta.env.VITE_DATABASE_URL}/functions/v1/fetch-live`
      : '',
  },
} as const;

// Export individuels pour faciliter l'import
export const DATABASE_URL = config.supabase.url;
export const DATABASE_ANON_KEY = config.supabase.anonKey;
