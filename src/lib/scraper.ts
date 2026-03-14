// Client-side scraper for bet261.mg Instant League
// NOTE: Browser CORS restrictions prevent direct API access
// Users in Madagascar must use the Python scraper

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
  // Try Vercel API proxy first (works if Vercel servers are not geo-blocked)
  try {
    const apiUrl = '/api/scrape';
    
    console.log('Trying Vercel API proxy...');
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      
      if (data.success) {
        // Save to Supabase
        await saveToSupabase(data.matches, data.ranking, data.results);
        
        return {
          success: true,
          matches: data.matches?.length || 0,
          results: data.results?.length || 0,
          ranking: data.ranking?.length || 0,
        };
      }
      
      // API returned an error
      if (data.geoBlocked) {
        console.log('Vercel API is geo-blocked');
      }
    }
  } catch (err) {
    console.log('Vercel API failed:', err);
  }

  // Direct scraping from browser is NOT possible due to CORS
  // sporty-tech.net does not allow cross-origin requests from browsers
  // Even with correct headers, the browser will block the request
  
  return {
    success: false,
    matches: 0,
    results: 0,
    ranking: 0,
    error: "Le scraping depuis le navigateur est bloqué par CORS.\n\nUtilisez le scraper Python depuis votre téléphone (Termux) avec une connexion 4G Madagascar.",
    needPython: true,
  };
}

// Save scraped data to Supabase
async function saveToSupabase(matches: any[], ranking: any[], results: any[]): Promise<void> {
  const scrapedAt = new Date().toISOString();

  // Delete old data
  await supabase.from("scraped_data").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // Insert new data
  const inserts = [];
  
  if (matches.length > 0) {
    inserts.push(supabase.from("scraped_data").insert({
      data_type: "matches",
      league: "Instant League",
      payload: matches,
      scraped_at: scrapedAt,
    }));
  }

  if (ranking.length > 0) {
    inserts.push(supabase.from("scraped_data").insert({
      data_type: "ranking",
      league: "Instant League",
      payload: ranking,
      scraped_at: scrapedAt,
    }));
  }

  if (results.length > 0) {
    inserts.push(supabase.from("scraped_data").insert({
      data_type: "results",
      league: "Instant League",
      payload: results,
      scraped_at: scrapedAt,
    }));
  }

  await Promise.all(inserts);
}
