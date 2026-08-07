import { useState, useEffect, useCallback, useRef } from "react";
import { config } from "@/config/env";
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
async function fetchQuickResults(leagueId: string): Promise<{
  hasResults: boolean;
  playoutResults: any[];
  bettingRound: number;
  nextRoundStart: string | null;
  elapsed: number;
} | null> {
  try {
    const res = await fetch(`${config.api.fetchLiveUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, mode: 'quick-results' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
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

// Fetch depuis l'API via Vercel API Route
async function fetchFromAPI(leagueId: string, leagueName: string): Promise<{
  matches: ScrapedMatch[];
  results: MatchResult[];
  ranking: RankingEntry[];
  nextRoundStart: string | null;
} | null> {
  try {
    const res = await fetch(`${config.api.fetchLiveUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId }),
    });

    if (!res.ok) {
      console.warn(`[fetchFromAPI] API error ${res.status} pour ${leagueName}`);
      return null;
    }

    const data = await res.json();

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
        prediction: m.prediction || null,
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

  const fetchVersionRef = useRef(0);
  const fetchingRef = useRef(false);
  const apiDataReceivedRef = useRef(false);
  const matchesRef = useRef<ScrapedMatch[]>([]);
  matchesRef.current = matches;

  const selectedLeague: LeagueInfo = AVAILABLE_LEAGUES.find(l => l.id === selectedLeagueId) || AVAILABLE_LEAGUES[0];

  // Charger les données depuis Neon (cache)
  const loadFromDatabaseRaw = useCallback(async (leagueName?: string): Promise<{
    matches: ScrapedMatch[];
    results: MatchResult[];
    ranking: RankingEntry[];
    lastUpdate: string;
  } | null> => {
    const targetLeague = leagueName || selectedLeague.name;

    try {
      const res = await fetch(`${config.api.scrapedData}?league=${encodeURIComponent(targetLeague)}`);
      if (!res.ok) return null;
      const json = await res.json();
      const data = json.rows;

      if (!data || !Array.isArray(data) || data.length === 0) return null;

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
  const fetchData = useCallback(async (leagueId: LeagueId, leagueName: string, isPoll = false) => {
    if (isPoll && fetchingRef.current) return;
    if (!isPoll && fetchingRef.current) {
      fetchingRef.current = false;
    }
    fetchingRef.current = true;

    const thisVersion = fetchVersionRef.current;

    try {
      if (!isPoll) {
        setLoading(true);
      }
      setError(null);

      const shouldLoadCache = !apiDataReceivedRef.current || !isPoll;
      const [apiData, cacheData] = await Promise.all([
        fetchFromAPI(leagueId, leagueName),
        shouldLoadCache ? loadFromDatabaseRaw(leagueName) : Promise.resolve(null),
      ]);

      if (fetchVersionRef.current !== thisVersion) {
        console.log(`[fetchData] Discarded stale results for ${leagueName} (version ${thisVersion} → ${fetchVersionRef.current})`);
        return;
      }

      if (apiData && apiData.matches.length > 0) {
        setMatches(apiData.matches);
        setResults(apiData.results);
        setRanking(apiData.ranking);
        setLastUpdate(new Date().toISOString());
        setDataSource("api");
        apiDataReceivedRef.current = true;
        if (apiData.nextRoundStart) {
          nextRoundStartRef.current = apiData.nextRoundStart;
        }
      } else if (cacheData && cacheData.matches.length > 0 && !isPoll) {
        setMatches(cacheData.matches);
        setResults(cacheData.results);
        setRanking(cacheData.ranking);
        setLastUpdate(cacheData.lastUpdate);
        setDataSource("cache");
      } else if (!apiDataReceivedRef.current && !isPoll) {
        setError(getFriendlyError(leagueName));
      }
    } finally {
      if (!isPoll) {
        setLoading(false);
      }
      fetchingRef.current = false;
    }
  }, [loadFromDatabaseRaw]);

  const fetchMatches = useCallback(async () => {
    await fetchData(selectedLeagueId, selectedLeague.name);
  }, [fetchData, selectedLeagueId, selectedLeague.name]);

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

  const refreshData = useCallback(async () => {
    setScraping(true);
    await fetchData(selectedLeagueId, selectedLeague.name);
    setScraping(false);
  }, [fetchData, selectedLeagueId, selectedLeague.name]);

  const changeLeague = useCallback(async (leagueId: LeagueId) => {
    const newLeague = AVAILABLE_LEAGUES.find(l => l.id === leagueId);
    if (!newLeague) return;

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
  const nextRoundStartRef = useRef<string | null>(null);
  const lastFullFetchRef = useRef(0);

  useEffect(() => {
    if (loading) return;

    const NORMAL_INTERVAL = 5000;
    const RAPID_INTERVAL = 200;
    const FULL_RAPID_INTERVAL = 500;

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const scheduleNextPoll = () => {
      if (cancelled) return;

      const currentMatches = matchesRef.current;
      const bettingCount = currentMatches.filter(m => m.status === "betting").length;
      const preloadedCount = currentMatches.filter(m => m.status === "preloaded").length;
      const hasBetting = bettingCount > 0;
      const noPreloaded = preloadedCount === 0;

      const nextStart = nextRoundStartRef.current;
      let nextStartSoon = false;
      if (nextStart) {
        const timeUntil = Math.round((new Date(nextStart).getTime() - Date.now()) / 1000);
        nextStartSoon = timeUntil <= 120 && timeUntil >= -30;
      }

      const isRapid = (hasBetting && noPreloaded) || nextStartSoon;
      const useQuickResults = isRapid && hasBetting;
      const interval = useQuickResults ? RAPID_INTERVAL : isRapid ? FULL_RAPID_INTERVAL : NORMAL_INTERVAL;

      timeoutId = setTimeout(async () => {
        if (cancelled) return;

        if (useQuickResults) {
          const qr = await fetchQuickResults(selectedLeagueId);
          if (cancelled) return;

          if (qr?.nextRoundStart) {
            nextRoundStartRef.current = qr.nextRoundStart;
          }

          if (qr?.hasResults) {
            console.log(`[Poll] 🎯 Playout detected! ${qr.playoutResults.length} results in ${qr.elapsed}ms → full fetch`);
            await fetchData(selectedLeagueId, selectedLeague.name, true);
            lastFullFetchRef.current = Date.now();
          }
        } else {
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

  useEffect(() => {
    const newRound = matches.find(m => m.round)?.round || 0;
    if (newRound !== currentRound) {
      console.log(`[Poll] Round changed: ${currentRound} → ${newRound}`);
      setCurrentRound(newRound);
    }
  }, [matches, currentRound]);

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
