import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ScrapedMatch, ScrapedData, MatchResult as ScrapedResult, RankingEntry } from "@/lib/types";
import { toast } from "sonner";

const REFRESH_INTERVAL = 2 * 60 * 1000;

export function useLiveMatches() {
  const [matches, setMatches] = useState<ScrapedMatch[]>([]);
  const [results, setResults] = useState<ScrapedResult[]>([]);
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [geoBlocked, setGeoBlocked] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMatches = useCallback(async (silent = false, league?: string) => {
    if (!silent) setLoading(true);
    setError(null);
    setGeoBlocked(false);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("scrape-odds", {
        body: { league: league || "" },
      });

      if (fnError) throw new Error(fnError.message);

      const result = data as ScrapedData;

      if (!result.success) {
        if (result.geoBlocked) setGeoBlocked(true);
        throw new Error(result.error || "Échec du scraping");
      }

      setMatches(result.matches || []);
      setResults(result.results || []);
      setRanking(result.ranking || []);
      setLastUpdate(result.scrapedAt || new Date().toISOString());

      const total = (result.matches?.length || 0) + (result.results?.length || 0) + (result.ranking?.length || 0);
      if (!silent && total > 0) {
        toast.success(`${result.matches?.length || 0} matchs, ${result.results?.length || 0} résultats, ${result.ranking?.length || 0} équipes 🔥`);
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
    const league = m.league || "Autre";
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
    geoBlocked,
    fetchMatches,
    startAutoRefresh,
    stopAutoRefresh,
  };
}
