// Auto-scraper types and league definitions
// Les données sont scrapées par le script Python et stockées dans Supabase

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

// Fonction placeholder - les données sont chargées directement depuis Supabase
export async function runScrape(leagueId: LeagueId = "8035"): Promise<{
  success: boolean;
  matches: number;
  ranking: number;
  results: number;
  error?: string;
  league?: string;
}> {
  const league = AVAILABLE_LEAGUES.find(l => l.id === leagueId);
  
  return {
    success: false,
    matches: 0,
    ranking: 0,
    results: 0,
    error: "Utilisez le script Python pour scraper les données: python s.py",
    league: league?.name,
  };
}
