import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { runScrape, AVAILABLE_LEAGUES, type LeagueId, type LeagueInfo } from "@/lib/auto-scraper";
import type { ScrapedMatch, MatchResult, RankingEntry } from "@/lib/types";
import { toast } from "sonner";

const AUTO_SCRAPE_INTERVAL = 30000; // 30 secondes

interface ScrapedDataRaw {
  id: string;
  data_type: string;
  league: string | null;
  league_id?: string;
  payload: any;
  scraped_at: string;
  created_at: string;
}

export function useLiveMatches() {
  const [matches, setMatches] = useState<ScrapedMatch[]>([]);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoScrapeActive, setAutoScrapeActive] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState<LeagueId>("8035");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Obtenir la ligue sélectionnée
  const selectedLeague: LeagueInfo = AVAILABLE_LEAGUES.find(l => l.id === selectedLeagueId) || AVAILABLE_LEAGUES[0];

  // Load data from Supabase table for the selected league
  const loadFromDatabase = useCallback(async (leagueName?: string) => {
    try {
      // Pour l'instant, charger toutes les données car le nom de ligue peut varier
      const { data, error: dbError } = await supabase
        .from("scraped_data")
        .select("*")
        .order("scraped_at", { ascending: false });

      if (dbError) throw new Error(dbError.message);

      if (!data || data.length === 0) {
        return false;
      }

      const rawData = data as ScrapedDataRaw[];

      // Filtrer par ligue si spécifié
      const targetLeague = leagueName || selectedLeague.name;
      const filteredData = rawData.filter(d => d.league === targetLeague || !d.league);

      if (filteredData.length === 0) {
        // Essayer avec "Instant League" comme fallback
        const instantLeagueData = rawData.filter(d => d.league === "Instant League");
        if (instantLeagueData.length === 0) {
          return false;
        }
      }

      const dataToUse = filteredData.length > 0 ? filteredData : rawData;

      // Get latest by type
      const latestMatches = dataToUse.find((d: any) => d.data_type === "matches");
      const latestResults = dataToUse.find((d: any) => d.data_type === "results");
      const latestRanking = dataToUse.find((d: any) => d.data_type === "ranking");

      // Parse matches
      if (latestMatches?.payload) {
        const parsedMatches = Array.isArray(latestMatches.payload)
          ? latestMatches.payload
          : [];
        console.log(`📋 Parsing ${parsedMatches.length} matches from DB`);
        setMatches(parsedMatches.map((m: any) => ({
          league: m.league || targetLeague,
          home: m.home || "",
          away: m.away || "",
          kickoff: m.kickoff || m.expectedStart || "",
          oddHome: m.oddHome || 0,
          oddDraw: m.oddDraw || 0,
          oddAway: m.oddAway || 0,
          status: m.status || "upcoming",
          minute: m.minute || null,
          scoreHome: m.scoreHome ?? null,
          scoreAway: m.scoreAway ?? null,
          stats: m.stats || null,
          id: m.id,
          round: m.round,
        })));
      } else {
        setMatches([]);
      }

      // Parse results
      if (latestResults?.payload) {
        const parsedResults = Array.isArray(latestResults.payload)
          ? latestResults.payload
          : [];
        setResults(parsedResults.map((r: any) => ({
          home: r.home || r.homeTeam || "",
          away: r.away || r.awayTeam || "",
          scoreHome: r.scoreHome ?? r.score_home ?? r.homeScore ?? 0,
          scoreAway: r.scoreAway ?? r.score_away ?? r.awayScore ?? 0,
          league: r.league || targetLeague,
          matchday: r.matchday || r.round || "",
        })));
      } else {
        setResults([]);
      }

      // Parse ranking
      if (latestRanking?.payload) {
        const parsedRanking = Array.isArray(latestRanking.payload)
          ? latestRanking.payload
          : [];
        setRanking(parsedRanking.map((t: any) => ({
          position: t.position || t.rank || 0,
          team: t.team || t.name || "",
          played: t.played || t.games || 0,
          won: t.won || 0,
          drawn: t.drawn || t.draw || 0,
          lost: t.lost || 0,
          goalsFor: t.goalsFor || t.goals_for || t.gf || 0,
          goalsAgainst: t.goalsAgainst || t.goals_against || t.ga || 0,
          goalDifference: t.goalDifference || t.goal_diff || t.gd || 0,
          points: t.points || t.pts || 0,
        })));
      } else {
        setRanking([]);
      }

      // Set last update time
      const latestScrapedAt = dataToUse[0]?.scraped_at;
      setLastUpdate(latestScrapedAt || new Date().toISOString());

      return true;
    } catch (err) {
      console.error("Error loading from database:", err);
      return false;
    }
  }, [selectedLeague]);

  // Scrape data via Edge Function
  const scrapeData = useCallback(async (silent = false) => {
    setScraping(true);
    setError(null);

    try {
      const result = await runScrape(selectedLeagueId);

      if (!result.success) {
        // Try to load existing data from DB anyway
        const hasData = await loadFromDatabase();

        if (hasData) {
          setError(null);
          if (!silent) {
            // Ne pas afficher d'erreur si on a des données en cache
            console.log("✅ Données chargées depuis le cache");
          }
        } else {
          setError(result.error || "Échec du scraping");
          if (!silent) {
            toast.error(result.error || "Échec du scraping");
          }
        }
      } else {
        // Load the newly scraped data
        await loadFromDatabase();

        if (!silent) {
          toast.success(`✅ ${selectedLeague.flag} ${result.matches} matchs, ${result.ranking} équipes, ${result.results} résultats`);
        }
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";

      const hasData = await loadFromDatabase();

      if (hasData) {
        setError(null);
        if (!silent) {
          console.log("✅ Données chargées depuis le cache");
        }
      } else {
        setError(msg);
        if (!silent) {
          toast.error(`Erreur: ${msg}`);
        }
      }

      return { success: false, matches: 0, results: 0, ranking: 0, error: msg };
    } finally {
      setScraping(false);
    }
  }, [selectedLeagueId, selectedLeague, loadFromDatabase]);

  // Fetch matches - load from DB first, don't call Edge Function automatically
  const fetchMatches = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    // Load existing data from DB
    const hasData = await loadFromDatabase();

    if (!silent) {
      if (hasData) {
        console.log(`📊 ${selectedLeague.flag} ${selectedLeague.name} chargé depuis le cache`);
      } else {
        // No data in cache - show message
        setError("Aucune donnée en cache. Cliquez sur le bouton refresh pour actualiser.");
      }
    }

    setLoading(false);
  }, [loadFromDatabase, selectedLeague]);

  // Force refresh - scrape new data
  const refreshData = useCallback(async () => {
    return scrapeData(false);
  }, [scrapeData]);

  // Start auto-scraping (every 30 seconds)
  const startAutoRefresh = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    setAutoScrapeActive(true);

    // Scrape immediately
    scrapeData(true);

    // Then every 30 seconds
    intervalRef.current = setInterval(() => {
      scrapeData(true);
    }, AUTO_SCRAPE_INTERVAL);

    toast.success(`🔄 Auto-scraping activé (30s)`);
  }, [scrapeData]);

  // Stop auto-scraping
  const stopAutoRefresh = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setAutoScrapeActive(false);
    toast.info("⏹️ Auto-scraping désactivé");
  }, []);

  // Change league
  const changeLeague = useCallback(async (leagueId: LeagueId) => {
    // Stop auto-refresh if active
    if (autoScrapeActive) {
      stopAutoRefresh();
    }

    setSelectedLeagueId(leagueId);

    // Clear current data
    setMatches([]);
    setResults([]);
    setRanking([]);
    setError(null);

    // Load data for new league from cache
    const newLeague = AVAILABLE_LEAGUES.find(l => l.id === leagueId);
    if (newLeague) {
      setLoading(true);
      const hasData = await loadFromDatabase(newLeague.name);

      if (!hasData) {
        setError(`Aucune donnée pour ${newLeague.name}. Cliquez sur refresh pour actualiser.`);
      }
      setLoading(false);
    }
  }, [autoScrapeActive, stopAutoRefresh, loadFromDatabase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Load data on mount
  useEffect(() => {
    fetchMatches();
  }, []);

  const matchesByLeague = matches.reduce<Record<string, ScrapedMatch[]>>((acc, m) => {
    const league = m.league || selectedLeague.name;
    if (!acc[league]) acc[league] = [];
    acc[league].push(m);
    return acc;
  }, {});

  return {
    matches,
    results,
    ranking,
    matchesByLeague,
    loading,
    scraping,
    lastUpdate,
    error,
    autoScrapeActive,
    geoBlocked: false,
    selectedLeagueId,
    selectedLeague,
    availableLeagues: AVAILABLE_LEAGUES,
    fetchMatches,
    refreshData,
    startAutoRefresh,
    stopAutoRefresh,
    changeLeague,
  };
}
