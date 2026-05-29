// Configuration centralisée de l'application
// Point d'entrée UNIQUE pour toutes les variables d'environnement
// Ne pas dupliquer ces constantes dans d'autres fichiers

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Vérification de la configuration
if (typeof window !== 'undefined') {
  console.log('[DEBUG] SUPABASE_URL:', SUPABASE_URL || '(VIDE)');
  console.log('[DEBUG] ANON_KEY:', SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.substring(0, 10) + '...' : '(VIDE)');
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('⚠️ Configuration Supabase manquante. Vérifiez les variables d\'environnement.');
  }
}

export const config = {
  supabase: {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
  },
  api: {
    fetchLiveUrl: SUPABASE_URL
      ? `${SUPABASE_URL}/functions/v1/fetch-live`
      : '',
  },
} as const;
