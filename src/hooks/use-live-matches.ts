import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ScrapedMatch, ScrapedData } from "@/lib/types";
import { toast } from "sonner";

const REFRESH_INTERVAL = 2 * 60 * 1000; // 2 minutes

export function useLiveMatches() {
  const [matches, setMatches] = useState<ScrapedMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMatches = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("scrape-odds", {
        body: { url: "https://bet261.mg/virtual" },
      });

      if (fnError) {
        throw new Error(fnError.message);
      }

      const result = data as ScrapedData;

      if (!result.success) {
        throw new Error(result.error || "Échec du scraping");
      }

      setMatches(result.matches || []);
      setLastUpdate(result.scrapedAt || new Date().toISOString());

      if (!silent && result.matches?.length > 0) {
        toast.success(`${result.matches.length} matchs récupérés 🔥`);
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

  // Group matches by league
  const matchesByLeague = matches.reduce<Record<string, ScrapedMatch[]>>((acc, m) => {
    const league = m.league || "Autre";
    if (!acc[league]) acc[league] = [];
    acc[league].push(m);
    return acc;
  }, {});

  return {
    matches,
    matchesByLeague,
    loading,
    lastUpdate,
    error,
    fetchMatches,
    startAutoRefresh,
    stopAutoRefresh,
  };
}
