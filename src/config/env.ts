// Configuration centralisée de l'application
// Point d'entrée UNIQUE pour toutes les variables d'environnement
// Ne pas dupliquer ces constantes dans d'autres fichiers

export const DATABASE_URL = import.meta.env.VITE_DATABASE_URL || '';
export const DATABASE_ANON_KEY = import.meta.env.VITE_DATABASE_ANON_KEY || '';

// Vérification de la configuration
if (typeof window !== 'undefined' && (!DATABASE_URL || !DATABASE_ANON_KEY)) {
  console.warn('⚠️ Configuration Supabase manquante. Vérifiez les variables d\'environnement.');
}

export const config = {
  supabase: {
    url: DATABASE_URL,
    anonKey: DATABASE_ANON_KEY,
  },
  api: {
    fetchLiveUrl: DATABASE_URL
      ? `${DATABASE_URL}/functions/v1/fetch-live`
      : '',
  },
} as const;
