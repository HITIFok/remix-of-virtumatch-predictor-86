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

// Fetch QUICK-RESULTS mode — only 2 API calls for ultra-fast result detection
// Returns playout data for betting round if available (~500ms vs ~2-3s full)
async function fetchQuickResults(leagueId: string): Promise<{
  hasResults: boolean;
  playoutResults: any[];
  bettingRound: number;
  nextRoundStart: string | null;
  elapsed: number;
} | null> {
  try {
    const { data, error: fnError } = await supabase.functions.invoke('fetch-live', {
      body: { leagueId, mode: 'quick-results' },
    });
    if (fnError || !data?.success) return null;
    return {
      hasResults: data.hasResults || false,
      playoutResults: data.playoutResults || [],
      bettingRound: data.bettingRound || 0,
      nextRoundStart: data.nextRoundStart || null,
      elapsed: data.elapsed || 0,
    };
  } catch {
    return null;
  }
}

// Fetch depuis l'API via Supabase Edge Function (utilise supabase.functions.invoke pour l'auth auto)
async function fetchFromAPI(leagueId: string, leagueName: string): Promise<{
  matches: ScrapedMatch[];
  results: MatchResult[];
  ranking: RankingEntry[];
  nextRoundStart: string | null;
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
        prediction: m.prediction || null, // v14: Score exact odds from Sporty API
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
      nextRoundStart: data.nextRoundStart || null,
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

  // Charger les données depuis Supabase (cache) — version silencieuse qui retourne les données sans setter le state
  const loadFromDatabaseRaw = useCallback(async (leagueName?: string): Promise<{
    matches: ScrapedMatch[];
    results: MatchResult[];
    ranking: RankingEntry[];
    lastUpdate: string;
  } | null> => {
    const targetLeague = leagueName || selectedLeague.name;

    try {
      const { data, error: dbError } = await supabase
        .from("scraped_data")
        .select("*")
        .eq("league", targetLeague)
        .order("scraped_at", { ascending: false });

      if (dbError) throw new Error(dbError.message);
      if (!data || data.length === 0) return null;

      const rawData = data as ScrapedDataRaw[];
      const matchesEntry = rawData.find(d => d.data_type === "matches");
      const resultsEntry = rawData.find(d => d.data_type === "results");
      const rankingEntry = rawData.find(d => d.data_type === "ranking");

      const matches: ScrapedMatch[] = matchesEntry?.payload && Array.isArray(matchesEntry.payload)
        ? matchesEntry.payload.map((m: any) => ({
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
          }))
        : [];

      const results: MatchResult[] = resultsEntry?.payload && Array.isArray(resultsEntry.payload)
        ? resultsEntry.payload.map((r: any) => ({
            home: r.home || "",
            away: r.away || "",
            scoreHome: r.scoreHome ?? 0,
            scoreAway: r.scoreAway ?? 0,
            league: r.league || targetLeague,
            matchday: r.matchday || r.round || "",
          }))
        : [];

      const ranking: RankingEntry[] = rankingEntry?.payload && Array.isArray(rankingEntry.payload)
        ? rankingEntry.payload.map((t: any) => ({
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
          }))
        : [];

      const lastUpdate = matchesEntry?.scraped_at || rawData[0]?.scraped_at || new Date().toISOString();
      return { matches, results, ranking, lastUpdate };
    } catch (err) {
      console.error("[loadFromDatabaseRaw] Erreur cache:", err);
      return null;
    }
  }, [selectedLeague]);

  // Charger les données : API proxy en parallèle avec cache (silencieux)
  // v14 FIX: loadFromDatabaseRaw ne set plus le state directement → élimine le flicker Cache ↔ API
  // v17 FIX: fetchVersionRef used to invalidate stale fetches on league change
  const fetchData = useCallback(async (leagueId: LeagueId, leagueName: string, isPoll = false) => {
    // v17: Allow only one non-poll fetch at a time, but ALWAYS allow polls
    // to be interrupted by a league change (non-poll fetch).
    if (isPoll && fetchingRef.current) return;
    if (!isPoll && fetchingRef.current) {
      // A poll is running — cancel it by resetting the flag
      fetchingRef.current = false;
    }
    fetchingRef.current = true;

    // Capture the current version — if it changes (league switch), discard results
    const thisVersion = fetchVersionRef.current;

    try {
      // For polling, don't show loading state
      if (!isPoll) {
        setLoading(true);
      }
      setError(null);

      // Run API + cache in parallel. Cache fetch is SILENT (no setState) to prevent flicker.
      // fetchData itself decides which data to use AFTER both resolve.
      const shouldLoadCache = !apiDataReceivedRef.current || !isPoll;
      const [apiData, cacheData] = await Promise.all([
        fetchFromAPI(leagueId, leagueName),
        shouldLoadCache ? loadFromDatabaseRaw(leagueName) : Promise.resolve(null),
      ]);

      // v17: If version changed during fetch, these results are STALE — discard them
      if (fetchVersionRef.current !== thisVersion) {
        console.log(`[fetchData] Discarded stale results for ${leagueName} (version ${thisVersion} → ${fetchVersionRef.current})`);
        return;
      }

      // API wins always — set state only once (no flicker)
      if (apiData && apiData.matches.length > 0) {
        setMatches(apiData.matches);
        setResults(apiData.results);
        setRanking(apiData.ranking);
        setLastUpdate(new Date().toISOString());
        setDataSource("api");
        apiDataReceivedRef.current = true;
        // Update nextRoundStart for PREDICT-AHEAD polling
        if (apiData.nextRoundStart) {
          nextRoundStartRef.current = apiData.nextRoundStart;
        }
      } else if (cacheData && cacheData.matches.length > 0 && !isPoll) {
        // Fallback to cache ONLY on initial load (not during polls)
        setMatches(cacheData.matches);
        setResults(cacheData.results);
        setRanking(cacheData.ranking);
        setLastUpdate(cacheData.lastUpdate);
        setDataSource("cache");
      } else if (!apiDataReceivedRef.current && !isPoll) {
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
  }, [loadFromDatabaseRaw]);

  // Charger au démarrage
  const fetchMatches = useCallback(async () => {
    await fetchData(selectedLeagueId, selectedLeague.name);
  }, [fetchData, selectedLeagueId, selectedLeague.name]);

  // Alias pour compatibilité (utilisé en fallback)
  const loadFromDatabase = useCallback(async (leagueName?: string) => {
    const data = await loadFromDatabaseRaw(leagueName);
    if (data && data.matches.length > 0) {
      if (apiDataReceivedRef.current) return true;
      setMatches(data.matches);
      setResults(data.results);
      setRanking(data.ranking);
      setLastUpdate(data.lastUpdate);
      setDataSource("cache");
      return true;
    }
    return false;
  }, [loadFromDatabaseRaw]);

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

    // v17: Increment version to invalidate any in-flight fetch
    fetchVersionRef.current++;
    fetchingRef.current = false;

    setSelectedLeagueId(leagueId);
    setMatches([]);
    setResults([]);
    setRanking([]);
    setError(null);
    setLastUpdate(null);
    setCurrentRound(0);
    setDataSource("cache");
    apiDataReceivedRef.current = false;
    nextRoundStartRef.current = null;

    await fetchData(leagueId, newLeague.name);
  }, [fetchData]);

  // ─── Auto-polling with PREDICT-AHEAD (v12) + QUICK-RESULTS (v16) ─────────
  // v16: In RAPID mode, uses fetchQuickResults (2 API calls, ~500ms)
  //      instead of full fetch-live (8 API calls, ~2-3s).
  //      When playout results detected → triggers one full fetch, then back to normal.
  // v12: Checks if nextRoundStart is within 120s → switch to RAPID
  //       to catch playout data BEFORE the round officially starts.
  const nextRoundStartRef = useRef<string | null>(null);
  // Track when we last did a full fetch (to avoid full fetches too close together)
  const lastFullFetchRef = useRef(0);

  useEffect(() => {
    if (loading) return; // Don't start polling until initial load is done

    const NORMAL_INTERVAL = 5000;   // 5s normal polling
    const RAPID_INTERVAL = 200;     // 200ms ultra-rapid for quick-results
    const FULL_RAPID_INTERVAL = 500; // 500ms rapid polling (full fetch fallback)

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const scheduleNextPoll = () => {
      if (cancelled) return;

      // Use REF to check match status (avoids 'matches' in dependency array)
      const currentMatches = matchesRef.current;
      const bettingCount = currentMatches.filter(m => m.status === "betting").length;
      const preloadedCount = currentMatches.filter(m => m.status === "preloaded").length;
      const hasBetting = bettingCount > 0;
      const noPreloaded = preloadedCount === 0;

      // Check if next round start is approaching (within 120s)
      const nextStart = nextRoundStartRef.current;
      let nextStartSoon = false;
      if (nextStart) {
        const timeUntil = Math.round((new Date(nextStart).getTime() - Date.now()) / 1000);
        nextStartSoon = timeUntil <= 120 && timeUntil >= -30;
      }

      // RAPID mode when: (1) betting without preloaded, OR (2) next round starting soon
      const isRapid = (hasBetting && noPreloaded) || nextStartSoon;

      // In rapid mode, use quick-results (ultra-fast) if we have betting matches
      const useQuickResults = isRapid && hasBetting;
      const interval = useQuickResults ? RAPID_INTERVAL : isRapid ? FULL_RAPID_INTERVAL : NORMAL_INTERVAL;

      timeoutId = setTimeout(async () => {
        if (cancelled) return;

        if (useQuickResults) {
          // ULTRA-FAST PATH: quick-results mode (2 API calls, ~500ms)
          const qr = await fetchQuickResults(selectedLeagueId);
          if (cancelled) return;

          // Update nextRoundStart from quick-results
          if (qr?.nextRoundStart) {
            nextRoundStartRef.current = qr.nextRoundStart;
          }

          // If playout results detected → do one full fetch to get everything
          if (qr?.hasResults) {
            console.log(`[Poll] 🎯 Playout detected! ${qr.playoutResults.length} results in ${qr.elapsed}ms → full fetch`);
            await fetchData(selectedLeagueId, selectedLeague.name, true);
            lastFullFetchRef.current = Date.now();
          }
        } else {
          // NORMAL / FULL PATH: standard fetch-live
          await fetchData(selectedLeagueId, selectedLeague.name, true);
          lastFullFetchRef.current = Date.now();
        }

        scheduleNextPoll();
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
