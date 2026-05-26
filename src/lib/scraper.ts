// Client-side scraper for bet261.mg Instant League
// Calls Supabase Edge Function which scrapes the API

import { supabase } from "@/integrations/supabase/client";

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
  try {
    console.log('Calling Supabase Edge Function auto-scrape...');

    // Call the Supabase Edge Function
    // Note: The x-cron-key is no longer sent from the client for security.
    // The Edge Function validates the request using Supabase auth or server-side secrets.
    const { data, error } = await supabase.functions.invoke('auto-scrape', {
      method: 'POST',
      body: {},
    });

    if (error) {
      console.error('Edge Function error:', error);
      return {
        success: false,
        matches: 0,
        results: 0,
        ranking: 0,
        error: `Erreur: ${error.message}`,
      };
    }

    if (data?.success) {
      console.log('Scrape successful:', data);
      return {
        success: true,
        matches: data.saved?.matches || 0,
        results: data.saved?.results || 0,
        ranking: data.saved?.ranking || 0,
      };
    }

    // API returned an error
    return {
      success: false,
      matches: 0,
      results: 0,
      ranking: 0,
      error: data?.error || "Échec du scraping",
      geoBlocked: data?.hint?.includes('geo-blocked'),
      needPython: data?.hint?.includes('Python'),
    };

  } catch (err) {
    console.error('Scrape error:', err);
    return {
      success: false,
      matches: 0,
      results: 0,
      ranking: 0,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}
