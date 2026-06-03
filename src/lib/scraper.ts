// Client-side scraper for Instant League
// ⚠️ SÉCURITÉ : Le scraping est désormais côté serveur uniquement
// Le cron auto-scrape s'exécute toutes les 2 minutes via pg_cron
// L'appel client-side est désactivé (auto-scrape requiert x-cron-key)

export interface ScraperResult {
  success: boolean;
  matches: number;
  results: number;
  ranking: number;
  error?: string;
  geoBlocked?: boolean;
  needPython?: boolean;
}

export async function scrapeInstantLeague(): Promise<ScraperResult> {
  // Client-side scraping is disabled for security.
  // The auto-scrape Edge Function runs via cron every 2 minutes
  // with x-cron-key authentication (not available client-side).
  return {
    success: false,
    matches: 0,
    results: 0,
    ranking: 0,
    error: "Le scraping automatique est géré par le serveur (cron toutes les 2 min).",
    needPython: false,
  };
}
