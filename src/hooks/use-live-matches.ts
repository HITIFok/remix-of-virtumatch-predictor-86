import { useState, useEffect, useCallback } from "react";
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
const FETCH_LIVE_URL = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/fetch-live`;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Fetch depuis l'API via Supabase Edge Function
async function fetchFromAPI(leagueId: string, leagueName: string): Promise<{
  matches: ScrapedMatch[];
  results: MatchResult[];
  ranking: RankingEntry[];
} | null> {
  try {
    const res = await fetch(`${FETCH_LIVE_URL}?leagueId=${leagueId}`, {
      headers: {
        "Accept": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) {
      console.log(`API returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!data.success) {
      console.log(`API error: ${data.error}`);
      return null;
    }

    console.log(`🟢 API: ${data.matches?.length || 0} matches (${data.liveCount || 0} en live) for ${leagueName}`);

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
    console.log(`API fetch failed for ${leagueName}:`, err);
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

  const selectedLeague: LeagueInfo = AVAILABLE_LEAGUES.find(l => l.id === selectedLeagueId) || AVAILABLE_LEAGUES[0];

  // Charger les données depuis Supabase (cache)
  const loadFromDatabase = useCallback(async (leagueName?: string) => {
    const targetLeague = leagueName || selectedLeague.name;
    console.log(`📦 Loading cache for: ${targetLeague}`);

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
      console.error("Cache error:", err);
      return false;
    }
  }, [selectedLeague]);

  // Charger les données : API proxy en parallèle avec cache
  const fetchData = useCallback(async (leagueId: LeagueId, leagueName: string) => {
    setLoading(true);
    setError(null);

    // Lancer les deux en parallèle
    const [apiData, cacheSuccess] = await Promise.all([
      fetchFromAPI(leagueId, leagueName),
      loadFromDatabase(leagueName),
    ]);

    // Si l'API a répondu, utiliser ses données (temps réel)
    if (apiData && apiData.matches.length > 0) {
      console.log(`🟢 Using LIVE data for ${leagueName}`);
      setMatches(apiData.matches);
      setResults(apiData.results);
      setRanking(apiData.ranking);
      setLastUpdate(new Date().toISOString());
      setDataSource("api");
    } else if (cacheSuccess) {
      console.log(`📦 Using CACHE for ${leagueName}`);
    } else {
      setError(`Aucune donnée pour ${leagueName}`);
    }

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
