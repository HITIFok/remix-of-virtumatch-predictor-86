// Auto-scraper via Supabase Edge Function
// L'Edge Function doit être déployée sur Supabase

import { supabase } from "@/integrations/supabase/client";

// Liste des ligues disponibles
export const AVAILABLE_LEAGUES = [
  { id: "8035", name: "English League", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "8060", name: "Coupe d'Afrique", flag: "🌍" },
  { id: "8056", name: "Champions League", flag: "🏆" },
  { id: "8036", name: "Italian League", flag: "🇮🇹" },
  { id: "8037", name: "Spanish League", flag: "🇪🇸" },
  { id: "8042", name: "French League", flag: "🇫🇷" },
  { id: "8043", name: "German League", flag: "🇩🇪" },
  { id: "8044", name: "Portuguese League", flag: "🇵🇹" },
] as const;

export type LeagueId = typeof AVAILABLE_LEAGUES[number]["id"];
export type LeagueInfo = typeof AVAILABLE_LEAGUES[number];

let scrapeIntervalId: ReturnType<typeof setInterval> | null = null;

// Appeler l'Edge Function auto-scrape
export async function runScrape(leagueId: LeagueId = "8035"): Promise<{
  success: boolean;
  matches: number;
  ranking: number;
  results: number;
  error?: string;
  league?: string;
}> {
  try {
    console.log(`🔄 Calling auto-scrape Edge Function for league ${leagueId}...`);

    const { data, error } = await supabase.functions.invoke('auto-scrape', {
      method: 'POST',
      headers: {
        'x-cron-key': 'bet261_cron_2024_mada',
      },
      body: {
        league_id: leagueId,
      },
    });

    if (error) {
      console.error("Edge Function error:", error);

      // Retourner un message plus explicite
      if (error.message?.includes('Failed to send') || error.message?.includes('fetch')) {
        return {
          success: false,
          matches: 0,
          ranking: 0,
          results: 0,
          error: "Edge Function non déployée. Déployez 'auto-scrape' sur Supabase ou utilisez le scraper Python.",
        };
      }

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
        league: data.league,
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
export function startAutoScrape(intervalMs: number = 30000, leagueId?: LeagueId): void {
  if (scrapeIntervalId) {
    console.log("⚠️ Auto-scrape already running");
    return;
  }

  console.log(`🚀 Starting auto-scrape every ${intervalMs / 1000}s`);

  // Scrap immédiat
  runScrape(leagueId);

  // Puis à intervalles réguliers
  scrapeIntervalId = setInterval(() => runScrape(leagueId), intervalMs);
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
