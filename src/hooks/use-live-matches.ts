import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { scrapeInstantLeague } from "@/lib/scraper";
import type { ScrapedMatch, MatchResult, RankingEntry } from "@/lib/types";
import { toast } from "sonner";

const REFRESH_INTERVAL = 2 * 60 * 1000;

interface ScrapedDataRaw {
  id: string;
  data_type: string;
  league: string | null;
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load data from Supabase table
  const loadFromDatabase = useCallback(async () => {
    try {
      const { data, error: dbError } = await supabase
        .from("scraped_data")
        .select("*")
        .order("scraped_at", { ascending: false });

      if (dbError) throw new Error(dbError.message);

      if (!data || data.length === 0) {
        return false;
      }

      const rawData = data as ScrapedDataRaw[];
      
      // Get latest by type
      const latestMatches = rawData.find(d => d.data_type === "matches");
      const latestResults = rawData.find(d => d.data_type === "results");
      const latestRanking = rawData.find(d => d.data_type === "ranking");

      // Parse matches
      if (latestMatches?.payload) {
        const parsedMatches = Array.isArray(latestMatches.payload) 
          ? latestMatches.payload 
          : [];
        setMatches(parsedMatches.map((m: any) => ({
          league: m.league || "Instant League",
          home: m.home || m.homeTeam || "",
          away: m.away || m.awayTeam || "",
          kickoff: m.kickoff || "",
          oddHome: m.oddHome || m.odd_home || 0,
          oddDraw: m.oddDraw || m.odd_draw || 0,
          oddAway: m.oddAway || m.odd_away || 0,
          status: m.status || "upcoming",
          minute: m.minute || null,
          scoreHome: m.scoreHome ?? m.score_home ?? null,
          scoreAway: m.scoreAway ?? m.score_away ?? null,
          stats: m.stats || null,
        })));
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
          league: r.league || "Instant League",
          matchday: r.matchday || r.round || "",
        })));
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
      }

      // Set last update time
      const latestScrapedAt = rawData[0]?.scraped_at;
      setLastUpdate(latestScrapedAt || new Date().toISOString());

      return true;
    } catch (err) {
      console.error("Error loading from database:", err);
      return false;
    }
  }, []);

  // Scrape data directly from browser (requires Madagascar IP)
  const scrapeData = useCallback(async (silent = false) => {
    setScraping(true);
    setError(null);

    try {
      const result = await scrapeInstantLeague();

      if (!result.success) {
        setError(result.error || "Échec du scraping");
        if (!silent) {
          toast.error(result.error || "Échec du scraping");
        }
        
        // Try to load existing data from DB anyway
        await loadFromDatabase();
      } else {
        // Load the newly scraped data
        await loadFromDatabase();
        
        if (!silent) {
          toast.success(`✅ ${result.matches} matchs, ${result.ranking} équipes, ${result.results} résultats`);
        }
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setError(msg);
      if (!silent) toast.error(`Erreur: ${msg}`);
      
      // Try to load existing data
      await loadFromDatabase();
      
      return { success: false, matches: 0, results: 0, ranking: 0, error: msg };
    } finally {
      setScraping(false);
    }
  }, [loadFromDatabase]);

  // Fetch matches - either scrape or load from DB
  const fetchMatches = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    // First, try to load existing data from DB
    const hasData = await loadFromDatabase();

    if (!silent) {
      if (hasData) {
        toast.info("Données chargées depuis le cache");
      } else {
        toast.info("Aucune donnée - Lancez le scraping");
      }
    }

    setLoading(false);
  }, [loadFromDatabase]);

  // Force refresh - scrape new data
  const refreshData = useCallback(async () => {
    return scrapeData(false);
  }, [scrapeData]);

  const startAutoRefresh = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => fetchMatches(true), REFRESH_INTERVAL);
  }, [fetchMatches]);

  const stopAutoRefresh = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopAutoRefresh();
  }, [stopAutoRefresh]);

  const matchesByLeague = matches.reduce<Record<string, ScrapedMatch[]>>((acc, m) => {
    const league = m.league || "Instant League";
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
    geoBlocked: false,
    fetchMatches,
    refreshData,
    startAutoRefresh,
    stopAutoRefresh,
  };
}
