import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ScrapedMatch, MatchResult, RankingEntry } from "@/lib/types";

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
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoScrapeActive, setAutoScrapeActive] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState<LeagueId>("8035");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedLeague: LeagueInfo = AVAILABLE_LEAGUES.find(l => l.id === selectedLeagueId) || AVAILABLE_LEAGUES[0];

  // Charger les données depuis Supabase
  const loadFromDatabase = useCallback(async (leagueName: string): Promise<boolean> => {
    console.log(`📦 Loading from Supabase: "${leagueName}"`);

    try {
      const { data, error: dbError } = await supabase
        .from("scraped_data")
        .select("*")
        .eq("league", leagueName);

      if (dbError) {
        console.error("❌ DB Error:", dbError);
        throw new Error(dbError.message);
      }

      if (!data || data.length === 0) {
        console.log(`❌ No data for: "${leagueName}"`);
        return false;
      }

      console.log(`✅ Found ${data.length} entries for "${leagueName}"`);

      const rawData = data as ScrapedDataRaw[];
      const matchesEntry = rawData.find(d => d.data_type === "matches");
      const resultsEntry = rawData.find(d => d.data_type === "results");
      const rankingEntry = rawData.find(d => d.data_type === "ranking");

      // Parser les matchs
      if (matchesEntry?.payload && Array.isArray(matchesEntry.payload)) {
        const parsed = matchesEntry.payload.map((m: any) => ({
          league: m.league || leagueName,
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
        }));
        console.log(`📋 ${parsed.length} matches loaded`);
        setMatches(parsed);
      } else {
        setMatches([]);
      }

      // Parser les résultats
      if (resultsEntry?.payload && Array.isArray(resultsEntry.payload)) {
        const parsed = resultsEntry.payload.map((r: any) => ({
          home: r.home || "",
          away: r.away || "",
          scoreHome: r.scoreHome ?? 0,
          scoreAway: r.scoreAway ?? 0,
          league: r.league || leagueName,
          matchday: r.matchday || r.round || "",
        }));
        console.log(`📊 ${parsed.length} results loaded`);
        setResults(parsed);
      } else {
        setResults([]);
      }

      // Parser le classement
      if (rankingEntry?.payload && Array.isArray(rankingEntry.payload)) {
        const parsed = rankingEntry.payload.map((t: any) => ({
          position: t.position || 0,
          team: t.team || t.name || "",
          played: t.played || 0,
          won: t.won || 0,
          drawn: t.drawn || t.draw || 0,
          lost: t.lost || 0,
          goalsFor: t.goalsFor || 0,
          goalsAgainst: t.goalsAgainst || 0,
          goalDifference: (t.goalsFor || 0) - (t.goalsAgainst || 0),
          points: t.points || 0,
        }));
        console.log(`🏆 ${parsed.length} teams loaded`);
        setRanking(parsed);
      } else {
        setRanking([]);
      }

      // Date de mise à jour
      const scrapedAt = matchesEntry?.scraped_at || rawData[0]?.scraped_at;
      setLastUpdate(scrapedAt || new Date().toISOString());

      return true;
    } catch (err) {
      console.error("❌ Error:", err);
      return false;
    }
  }, []);

  // Charger les données
  const fetchMatches = useCallback(async (leagueId: LeagueId, leagueName: string) => {
    setLoading(true);
    setError(null);

    const hasData = await loadFromDatabase(leagueName);

    if (!hasData) {
      setError(`Aucune donnée pour ${leagueName}. Exécutez le scraper.`);
    }

    setLoading(false);
  }, [loadFromDatabase]);

  // Refresh manuel
  const refreshData = useCallback(async () => {
    setScraping(true);
    await fetchMatches(selectedLeagueId, selectedLeague.name);
    setScraping(false);
  }, [fetchMatches, selectedLeagueId, selectedLeague.name]);

  // Auto-refresh (toutes les 30s)
  const startAutoRefresh = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setAutoScrapeActive(true);
    fetchMatches(selectedLeagueId, selectedLeague.name);
    intervalRef.current = setInterval(() => {
      fetchMatches(selectedLeagueId, selectedLeague.name);
    }, 30000);
  }, [fetchMatches, selectedLeagueId, selectedLeague.name]);

  const stopAutoRefresh = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setAutoScrapeActive(false);
  }, []);

  // Changer de ligue
  const changeLeague = useCallback(async (leagueId: LeagueId) => {
    if (autoScrapeActive) stopAutoRefresh();

    const newLeague = AVAILABLE_LEAGUES.find(l => l.id === leagueId);
    if (!newLeague) return;

    console.log(`🔀 Changing to: ${newLeague.name}`);

    setSelectedLeagueId(leagueId);
    setMatches([]);
    setResults([]);
    setRanking([]);
    setError(null);
    setLastUpdate(null);

    await fetchMatches(leagueId, newLeague.name);
  }, [autoScrapeActive, stopAutoRefresh, fetchMatches]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Charger au montage
  useEffect(() => {
    fetchMatches(selectedLeagueId, selectedLeague.name);
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
    fetchMatches: () => fetchMatches(selectedLeagueId, selectedLeague.name),
    refreshData,
    startAutoRefresh,
    stopAutoRefresh,
    changeLeague,
    dataSource: "cache" as const,
  };
}
