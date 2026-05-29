// Configuration centralisée de l'application
// Point d'entrée UNIQUE pour toutes les variables d'environnement
// Ne pas dupliquer ces constantes dans d'autres fichiers

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// API Routes Vercel — URL de base pour les appels backend sécurisés
// En web (Vercel) : window.location.origin = https://virtual-match-hitifproject.vercel.app ✓
// En APK (Capacitor) : window.location.origin = https://localhost ✗
//   → VITE_API_BASE doit être défini au build APK avec l'URL Vercel
export const API_BASE = import.meta.env.VITE_API_BASE ||
  (typeof window !== 'undefined' ? window.location.origin : '');

// Vérification de la configuration (debug uniquement)
if (typeof window !== 'undefined') {
  if (import.meta.env.DEV) {
    console.log('[CONFIG] API_BASE:', API_BASE);
    console.log('[CONFIG] SUPABASE_URL:', SUPABASE_URL ? SUPABASE_URL.substring(0, 20) + '...' : '(VIDE)');
  }
}

export const config = {
  supabase: {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
  },
  api: {
    // Vercel API Routes (backend sécurisé avec service_role)
    adminLogin: `${API_BASE}/api/admin-login`,
    adminVerify: `${API_BASE}/api/admin-verify`,
    adminDeleteCode: `${API_BASE}/api/admin-delete-code`,
    checkPremium: `${API_BASE}/api/check-premium`,
    // Edge Functions Supabase
    fetchLiveUrl: SUPABASE_URL
      ? `${SUPABASE_URL}/functions/v1/fetch-live`
      : '',
  },
} as const;
