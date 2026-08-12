// Configuration centralisée de l'application
// Point d'entrée UNIQUE pour toutes les variables d'environnement
// Ne pas dupliquer ces constantes dans d'autres fichiers

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

// URL de téléchargement de l'APK (configurée dans Vercel: VITE_APK_DOWNLOAD_URL)
export const APK_DOWNLOAD_URL = import.meta.env.VITE_APK_DOWNLOAD_URL || '';

export const config = {
  api: {
    // Vercel API Routes (backend sécurisé)
    adminLogin: `${API_BASE}/api/admin-login`,
    adminVerify: `${API_BASE}/api/admin-verify`,
    adminDeleteCode: `${API_BASE}/api/admin-delete-code`,
    adminCodes: `${API_BASE}/api/admin-codes`,
    checkPremium: `${API_BASE}/api/check-premium`,
    // API Routes replacing Supabase Edge Functions
    fetchLiveUrl: `${API_BASE}/api/fetch-live`,
    analyzeMatchUrl: `${API_BASE}/api/analyze-match`,
    verifyPredictionsUrl: `${API_BASE}/api/verify-predictions`,
    autoPlayoutUrl: `${API_BASE}/api/auto-playout?manual=true`,
    // API Routes replacing direct Neon SQL
    predictions: `${API_BASE}/api/predictions`,
    premiumActivate: `${API_BASE}/api/premium-activate`,
    scrapedData: `${API_BASE}/api/matches?mode=cache`,
  },
} as const;
