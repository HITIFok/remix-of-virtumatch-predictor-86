// Configuration centralisée de l'application
// Point d'entrée UNIQUE pour toutes les variables d'environnement
// Ne pas dupliquer ces constantes dans d'autres fichiers

export const DATABASE_URL = import.meta.env.VITE_DATABASE_URL || '';
export const DATABASE_ANON_KEY = import.meta.env.VITE_DATABASE_ANON_KEY || '';

// URL Vercel de production (pour les appels API Routes depuis l'APK)
const VERCEL_PRODUCTION_URL = 'https://virtual-match-hitifproject.vercel.app';

// API Routes Vercel — URL de base pour les appels backend sécurisés
// En web (Vercel) : window.location.origin = URL Vercel ✓
// En APK (Capacitor) : window.location.origin = 'https://localhost' ✗
//   → On utilise VITE_API_BASE si défini, sinon VERCEL_PRODUCTION_URL
export const API_BASE = (() => {
  // 1. Variable d'env explicite (priorité)
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  // 2. En web : window.location.origin est l'URL Vercel
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    if (origin && origin !== 'https://localhost' && origin !== 'capacitor://localhost' && origin !== 'http://localhost') {
      return origin;
    }
  }
  // 3. En APK : fallback sur l'URL Vercel de production
  return VERCEL_PRODUCTION_URL;
})();

export const config = {
  supabase: {
    url: DATABASE_URL,
    anonKey: DATABASE_ANON_KEY,
  },
  api: {
    // Vercel API Routes (backend sécurisé avec service_role)
    adminLogin: `${API_BASE}/api/admin-login`,
    adminVerify: `${API_BASE}/api/admin-verify`,
    adminDeleteCode: `${API_BASE}/api/admin-delete-code`,
    checkPremium: `${API_BASE}/api/check-premium`,
    // Edge Functions Supabase
    fetchLiveUrl: DATABASE_URL
      ? `${DATABASE_URL}/functions/v1/fetch-live`
      : '',
  },
} as const;
