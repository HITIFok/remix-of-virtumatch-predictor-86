import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch data directly from Supabase table (populated by Python scraper)
  const fetchMatches = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      // Query scraped_data table directly
      const { data, error: dbError } = await supabase
        .from("scraped_data")
        .select("*")
        .order("scraped_at", { ascending: false });

      if (dbError) throw new Error(dbError.message);

      if (!data || data.length === 0) {
        if (!silent) {
          toast.info("Aucune donnée. Lancez le scraper Python !");
        }
        return;
      }

      const rawData = data as ScrapedDataRaw[];
      
      // Group by data_type and get latest
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

      const total = 
        (latestMatches?.payload?.length || 0) + 
        (latestResults?.payload?.length || 0) + 
        (latestRanking?.payload?.length || 0);

      if (!silent && total > 0) {
        toast.success(`${latestMatches?.payload?.length || 0} matchs, ${latestResults?.payload?.length || 0} résultats, ${latestRanking?.payload?.length || 0} équipes 🔥`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setError(msg);
      if (!silent) toast.error(`Erreur: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

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
    lastUpdate,
    error,
    geoBlocked: false, // No longer using scraper, data comes from DB
    fetchMatches,
    startAutoRefresh,
    stopAutoRefresh,
  };
}
