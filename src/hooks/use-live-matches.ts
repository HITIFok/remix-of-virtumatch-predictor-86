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

// Supabase Edge Function URL (contourne CORS) - Configuré via variables d'environnement
const FETCH_LIVE_URL = `${import.meta.env.VITE_DATABASE_URL || ''}/functions/v1/fetch-live`;
const DATABASE_ANON_KEY = import.meta.env.VITE_DATABASE_ANON_KEY || '';

// Timeout de la requête fetch (10 secondes)
const FETCH_TIMEOUT_MS = 10_000;

// Délai avant retry (2 secondes)
const RETRY_DELAY_MS = 2_000;

/** Messages d'erreur conviviaux en français */
function getFriendlyError(leagueName: string): string {
  return `Les données en direct pour ${leagueName} ne sont pas disponibles pour le moment. Veuillez réessayer dans quelques instants.`;
}

/**
 * Requête fetch avec timeout et logique de retry.
 * En cas d'échec, retente une fois après RETRY_DELAY_MS.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (firstErr) {
    clearTimeout(timeoutId);
    console.warn("[fetchWithRetry] Première tentative échouée, retry dans 2s…", firstErr);

    // Attendre avant le retry
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

    // Seconde tentative
    const retryController = new AbortController();
    const retryTimeoutId = setTimeout(() => retryController.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: retryController.signal });
      clearTimeout(retryTimeoutId);
      return res;
    } catch (retryErr) {
      clearTimeout(retryTimeoutId);
      console.error("[fetchWithRetry] Retry échoué :", retryErr);
      throw retryErr;
    }
  }
}

// Fetch depuis l'API via Supabase Edge Function
async function fetchFromAPI(leagueId: string, leagueName: string): Promise<{
  matches: ScrapedMatch[];
  results: MatchResult[];
  ranking: RankingEntry[];
} | null> {
  try {
    const res = await fetchWithRetry(
      `${FETCH_LIVE_URL}?leagueId=${leagueId}`,
      {
        headers: {
          "Accept": "application/json",
          "apikey": DATABASE_ANON_KEY,
          "Authorization": `Bearer ${DATABASE_ANON_KEY}`,
        },
      },
    );

    if (!res.ok) {
      console.warn(`[fetchFromAPI] API a retourné ${res.status} pour ${leagueName}`);
      return null;
    }

    const data = await res.json();
    if (!data.success) {
      console.warn(`[fetchFromAPI] Erreur API pour ${leagueName}:`, data.error);
      return null;
    }

    return {
      matches: (data.matches || []).map((m: any) => ({
        id: m.id,
        home: m.home || "",
        away: m.away || "",
        round: m.round,
        league: leagueName,
        status: m.status || "upcoming", // live, betting, upcoming
        kickoff: m.kickoff || "",
        oddHome: m.oddHome || 0,
        oddDraw: m.oddDraw || 0,
        oddAway: m.oddAway || 0,
        minute: m.minute ?? null,
        scoreHome: m.scoreHome ?? null,
        scoreAway: m.scoreAway ?? null,
        stats: m.goals ? { goals: m.goals } : null,
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

  // Empêcher les requêtes concurrentes obsolètes (race condition au changement de ligue)
  const fetchVersionRef = useRef(0);

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
  const fetchData = useCallback(async (leagueId: LeagueId, leagueName: string) => {
    // Incrémenter la version pour invalider les anciennes requêtes
    const currentVersion = ++fetchVersionRef.current;

    setLoading(true);
    setError(null);

    // Lancer les deux en parallèle
    const [apiData, cacheSuccess] = await Promise.all([
      fetchFromAPI(leagueId, leagueName),
      loadFromDatabase(leagueName),
    ]);

    // Ignorer si une nouvelle requête a été lancée entre-temps
    if (fetchVersionRef.current !== currentVersion) return;

    // Si l'API a répondu, utiliser ses données (temps réel)
    if (apiData && apiData.matches.length > 0) {
      setMatches(apiData.matches);
      setResults(apiData.results);
      setRanking(apiData.ranking);
      setLastUpdate(new Date().toISOString());
      setDataSource("api");
    } else if (!cacheSuccess) {
      // Message d'erreur convivial : l'API ET le cache ont échoué
      setError(getFriendlyError(leagueName));
    }
    // Si le cache a fonctionné, les données sont déjà chargées par loadFromDatabase

    setLoading(false);
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

    await fetchData(leagueId, newLeague.name);
  }, [fetchData]);

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
  };
}
