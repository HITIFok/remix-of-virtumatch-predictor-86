// Auto-scraper via Supabase Edge Function (pas direct depuis navigateur à cause du certificat SSL invalide)
// L'Edge Function peut ignorer les erreurs de certificat

import { supabase } from "@/integrations/supabase/client";

interface ScrapedMatch {
  id: number;
  home: string;
  away: string;
  round: number;
  league: string;
  status: string;
  oddHome: number;
  oddDraw: number;
  oddAway: number;
  expectedStart: string;
}

interface ScrapedRanking {
  position: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

interface ScrapedResult {
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
  round: number;
  league: string;
}

let scrapeIntervalId: ReturnType<typeof setInterval> | null = null;

// Appeler l'Edge Function auto-scrape qui peut accéder à l'API
export async function runScrape(): Promise<{
  success: boolean;
  matches: number;
  ranking: number;
  results: number;
  error?: string;
}> {
  try {
    console.log("🔄 Calling auto-scrape Edge Function...");

    const { data, error } = await supabase.functions.invoke('auto-scrape', {
      method: 'POST',
      headers: {
        'x-cron-key': 'bet261_cron_2024_mada',
      },
    });

    if (error) {
      console.error("Edge Function error:", error);
      return {
        success: false,
        matches: 0,
        ranking: 0,
        results: 0,
        error: error.message,
      };
    }

    console.log("📊 Scrape result:", data);

    if (data?.success) {
      return {
        success: true,
        matches: data.saved?.matches || 0,
        ranking: data.saved?.ranking || 0,
        results: data.saved?.results || 0,
      };
    } else {
      return {
        success: false,
        matches: 0,
        ranking: 0,
        results: 0,
        error: data?.error || "Échec du scraping",
      };
    }
  } catch (error) {
    console.error("Scrape error:", error);
    return {
      success: false,
      matches: 0,
      ranking: 0,
      results: 0,
      error: error instanceof Error ? error.message : "Erreur inconnue",
    };
  }
}

// Démarrer le scraping automatique
export function startAutoScrape(intervalMs: number = 30000): void {
  if (scrapeIntervalId) {
    console.log("⚠️ Auto-scrape already running");
    return;
  }

  console.log(`🚀 Starting auto-scrape every ${intervalMs / 1000}s`);

  // Scrap immédiat
  runScrape();

  // Puis à intervalles réguliers
  scrapeIntervalId = setInterval(runScrape, intervalMs);
}

// Arrêter le scraping automatique
export function stopAutoScrape(): void {
  if (scrapeIntervalId) {
    clearInterval(scrapeIntervalId);
    scrapeIntervalId = null;
    console.log("🛑 Auto-scrape stopped");
  }
}

// Vérifier si le scraping est en cours
export function isAutoScrapeRunning(): boolean {
  return scrapeIntervalId !== null;
}
