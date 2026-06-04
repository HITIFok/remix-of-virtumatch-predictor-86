import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ScrapedMatch, MatchResult, RankingEntry } from "@/lib/types";

// Liste des ligues disponibles avec codes pays pour drapeaux réels
export const AVAILABLE_LEAGUES = [
  { id: "8035", name: "English League", countryCode: "gb-eng" },
  { id: "8060", name: "Coupe d'Afrique", countryCode: "africa" },
  { id: "8056", name: "Champions League", countryCode: "uefa" },
  { id: "8036", name: "Italian League", countryCode: "it" },
  { id: "8037", name: "Spanish League", countryCode: "es" },
  { id: "8042", name: "French League", countryCode: "fr" },
  { id: "8043", name: "German League", countryCode: "de" },
  { id: "8044", name: "Portuguese League", countryCode: "pt" },
  { id: "8065", name: "Coupe du monde", countryCode: "worldcup" },
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

/** Messages d'erreur conviviaux en français */
function getFriendlyError(leagueName: string): string {
  return `Les données en direct pour ${leagueName} ne sont pas disponibles pour le moment. Veuillez réessayer dans quelques instants.`;
}

// Fetch depuis l'API via Supabase Edge Function (utilise supabase.functions.invoke pour l'auth auto)
async function fetchFromAPI(leagueId: string, leagueName: string): Promise<{
  matches: ScrapedMatch[];
  results: MatchResult[];
  ranking: RankingEntry[];
} | null> {
  try {
    // supabase.functions.invoke() gère automatiquement apikey + Authorization + x-device-id
    const { data, error: fnError } = await supabase.functions.invoke('fetch-live', {
      body: { leagueId },
    });

    if (fnError) {
      console.warn(`[fetchFromAPI] Edge Function error ${fnError.code} pour ${leagueName}:`, fnError.message);
      return null;
    }

    if (!data || !data.success) {
      console.warn(`[fetchFromAPI] Erreur API pour ${leagueName}:`, data?.error);
      return null;
    }

    return {
      matches: (data.matches || []).map((m: any) => ({
        id: m.id,
        home: m.home || "",
        away: m.away || "",
        round: m.round,
        league: leagueName,
        leagueId: leagueId,
        status: m.status || "upcoming",
        kickoff: m.kickoff || "",
        oddHome: m.oddHome || 0,
        oddDraw: m.oddDraw || 0,
        oddAway: m.oddAway || 0,
        minute: m.minute ?? null,
        scoreHome: m.scoreHome ?? null,
        scoreAway: m.scoreAway ?? null,
        stats: m.goals ? { goals: m.goals } : null,
        predeterminedScore: m.predeterminedScore || null,
      })),
      results: (data.results || []).map((r: any) => ({
        home: r.home || "",
        away: r.away || "",
        scoreHome: r.scoreHome ?? 0,
        scoreAway: r.scoreAway ?? 0,
        league: leagueName,
        matchday: r.matchday || "",
      })),
      ranking: (data.ranking || []).map((t: any) => ({
        position: t.position || 0,
        team: t.team || "",
        played: t.played || 0,
        won: t.won || 0,
        drawn: t.drawn || 0,
        lost: t.lost || 0,
        goalsFor: t.goalsFor || 0,
        goalsAgainst: t.goalsAgainst || 0,
        goalDifference: (t.goalsFor || 0) - (t.goalsAgainst || 0),
        points: t.points || 0,
      })),
    };
  } catch (err) {
    console.error(`[fetchFromAPI] Échec de la requête pour ${leagueName}:`, err);
    return null;
  }
}

export function useLiveMatches() {
  const [matches, setMatches] = useState<ScrapedMatch[]>([]);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState<LeagueId>("8035");
  const [dataSource, setDataSource] = useState<"api" | "cache">("cache");
  const [currentRound, setCurrentRound] = useState<number>(0);

  // Empêcher les requêtes concurrentes obsolètes (race condition au changement de ligue)
  const fetchVersionRef = useRef(0);
  // Track if a fetch is in progress (to avoid overlapping polls)
  const fetchingRef = useRef(false);
  // Track if we've ever received API data — prevents flicker back to cache during polls
  const apiDataReceivedRef = useRef(false);
  // Ref for matches — used by polling loop to avoid 'matches' in useEffect deps (prevents flickering)
  const matchesRef = useRef<ScrapedMatch[]>([]);
  matchesRef.current = matches;

  const selectedLeague: LeagueInfo = AVAILABLE_LEAGUES.find(l => l.id === selectedLeagueId) || AVAILABLE_LEAGUES[0];

  // Charger les données depuis Supabase (cache)
  const loadFromDatabase = useCallback(async (leagueName?: string) => {
    const targetLeague = leagueName || selectedLeague.name;

    try {
      const { data, error: dbError } = await supabase
        .from("scraped_data")
        .select("*")
        .eq("league", targetLeague)
        .order("scraped_at", { ascending: false });

      if (dbError) throw new Error(dbError.message);
      if (!data || data.length === 0) return false;

      const rawData = data as ScrapedDataRaw[];
      const matchesEntry = rawData.find(d => d.data_type === "matches");
      const resultsEntry = rawData.find(d => d.data_type === "results");
      const rankingEntry = rawData.find(d => d.data_type === "ranking");

      if (matchesEntry?.payload && Array.isArray(matchesEntry.payload)) {
        // During polling, don't overwrite API data with stale cache
        if (apiDataReceivedRef.current) {
          return true;
        }
        setMatches(matchesEntry.payload.map((m: any) => ({
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

      if (resultsEntry?.payload && Array.isArray(resultsEntry.payload)) {
        setResults(resultsEntry.payload.map((r: any) => ({
          home: r.home || "",
          away: r.away || "",
          scoreHome: r.scoreHome ?? 0,
          scoreAway: r.scoreAway ?? 0,
          league: r.league || targetLeague,
          matchday: r.matchday || r.round || "",
        })));
      } else {
        setResults([]);
      }

      if (rankingEntry?.payload && Array.isArray(rankingEntry.payload)) {
        setRanking(rankingEntry.payload.map((t: any) => ({
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
        })));
      } else {
        setRanking([]);
      }

      setLastUpdate(matchesEntry?.scraped_at || rawData[0]?.scraped_at || new Date().toISOString());
      setDataSource("cache");
      return true;
    } catch (err) {
      console.error("[loadFromDatabase] Erreur cache:", err);
      return false;
    }
  }, [selectedLeague]);

  // Charger les données : API proxy en parallèle avec cache
  const fetchData = useCallback(async (leagueId: LeagueId, leagueName: string, isPoll = false) => {
    // Prevent overlapping fetches
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      // For polling, don't show loading state
      if (!isPoll) {
        setLoading(true);
      }
      setError(null);

      // Lancer les deux en parallèle
      // During polling, skip cache loading if we already have API data
      const shouldLoadCache = !apiDataReceivedRef.current || !isPoll;
      const [apiData, cacheSuccess] = await Promise.all([
        fetchFromAPI(leagueId, leagueName),
        shouldLoadCache ? loadFromDatabase(leagueName) : Promise.resolve(true),
      ]);

      // Si l'API a répondu, utiliser ses données (temps réel)
      if (apiData && apiData.matches.length > 0) {
        setMatches(apiData.matches);
        setResults(apiData.results);
        setRanking(apiData.ranking);
        setLastUpdate(new Date().toISOString());
        setDataSource("api");
        apiDataReceivedRef.current = true;
      } else if (!cacheSuccess && !isPoll) {
        // Message d'erreur convivial : l'API ET le cache ont échoué
        setError(getFriendlyError(leagueName));
      }
    } finally {
      // Only toggle loading for non-poll fetches (prevents UI flickering)
      if (!isPoll) {
        setLoading(false);
      }
      fetchingRef.current = false;
    }
  }, [loadFromDatabase]);

  // Charger au démarrage
  const fetchMatches = useCallback(async () => {
    await fetchData(selectedLeagueId, selectedLeague.name);
  }, [fetchData, selectedLeagueId, selectedLeague.name]);

  // Refresh manuel
  const refreshData = useCallback(async () => {
    setScraping(true);
    await fetchData(selectedLeagueId, selectedLeague.name);
    setScraping(false);
  }, [fetchData, selectedLeagueId, selectedLeague.name]);

  // Changer de ligue
  const changeLeague = useCallback(async (leagueId: LeagueId) => {
    const newLeague = AVAILABLE_LEAGUES.find(l => l.id === leagueId);
    if (!newLeague) return;

    setSelectedLeagueId(leagueId);
    setMatches([]);
    setResults([]);
    setRanking([]);
    setError(null);
    setLastUpdate(null);
    setCurrentRound(0);
    apiDataReceivedRef.current = false;

    await fetchData(leagueId, newLeague.name);
  }, [fetchData]);

  // ─── Auto-polling with DYNAMIC interval (v11) ──────────────────────
  // Uses setTimeout with recursive scheduling. Uses matchesRef instead of
  // matches in the dependency array to prevent effect re-runs on every
  // setMatches() call (which was causing 📦 Cache ↔ 🟢 Temps réel flickering).
  useEffect(() => {
    if (loading) return; // Don't start polling until initial load is done

    const NORMAL_INTERVAL = 5000;  // 5s normal polling
    const RAPID_INTERVAL = 500;   // 500ms rapid polling when waiting for playout

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const scheduleNextPoll = () => {
      if (cancelled) return;

      // Use REF to check match status (avoids 'matches' in dependency array)
      const currentMatches = matchesRef.current;
      const bettingCount = currentMatches.filter(m => m.status === "betting").length;
      const preloadedCount = currentMatches.filter(m => m.status === "preloaded").length;
      const isRapid = bettingCount > 0 && preloadedCount === 0;
      const interval = isRapid ? RAPID_INTERVAL : NORMAL_INTERVAL;

      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        await fetchData(selectedLeagueId, selectedLeague.name, true);
        scheduleNextPoll(); // Schedule next after this one completes
      }, interval);
    };

    scheduleNextPoll();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [loading, selectedLeagueId, selectedLeague.name, fetchData]);

  // Track current round changes
  useEffect(() => {
    const newRound = matches.find(m => m.round)?.round || 0;
    if (newRound !== currentRound) {
      console.log(`[Poll] Round changed: ${currentRound} → ${newRound}`);
      setCurrentRound(newRound);
    }
  }, [matches, currentRound]);

  // Charger au montage
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
    geoBlocked: false,
    selectedLeagueId,
    selectedLeague,
    availableLeagues: AVAILABLE_LEAGUES,
    fetchMatches,
    refreshData,
    changeLeague,
    dataSource,
    preloadedCount: matches.filter(m => m.status === "preloaded").length,
  };
}
