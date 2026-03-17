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

// API base URL
const API_BASE = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues";

// Fetch directly from API (browser-side)
async function fetchFromAPI(leagueId: string, leagueName: string): Promise<{
  matches: ScrapedMatch[];
  results: MatchResult[];
  ranking: RankingEntry[];
} | null> {
  try {
    // Use Promise.all with timeout for parallel requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const headers = {
      "Accept": "application/json",
    };

    // Fetch matches
    const matchesRes = await fetch(`${API_BASE}/${leagueId}/matches`, {
      method: "GET",
      headers,
      signal: controller.signal,
      mode: "cors",
    });

    clearTimeout(timeoutId);

    if (!matchesRes.ok) {
      console.log(`API returned ${matchesRes.status}`);
      return null;
    }

    const matchesData = await matchesRes.json();
    const matches: ScrapedMatch[] = [];

    // Parse matches
    if (matchesData?.rounds) {
      for (const rd of matchesData.rounds) {
        const roundNum = rd.roundNumber || 0;
        for (const m of rd.matches || []) {
          let oddHome = 0, oddDraw = 0, oddAway = 0;

          // Extract odds
          for (const bt of m.eventBetTypes || []) {
            if (bt.name === "1X2") {
              for (const it of bt.eventBetTypeItems || []) {
                const sn = (it.shortName || "").toUpperCase();
                const val = parseFloat(it.odds) || 0;
                if (sn === "1") oddHome = val;
                else if (sn === "X") oddDraw = val;
                else if (sn === "2") oddAway = val;
              }
              break;
            }
          }

          // Determine status
          const now = new Date();
          const kickoff = m.expectedStart ? new Date(m.expectedStart) : null;
          let status = "upcoming";
          if (kickoff && kickoff < now) {
            status = "betting";
          }

          if (oddHome > 0 || oddDraw > 0 || oddAway > 0) {
            matches.push({
              id: m.id,
              home: m.homeTeam?.name || "",
              away: m.awayTeam?.name || "",
              round: roundNum,
              league: leagueName,
              status,
              kickoff: m.expectedStart || "",
              oddHome,
              oddDraw,
              oddAway,
              minute: null,
              scoreHome: null,
              scoreAway: null,
              stats: null,
            });
          }
        }
      }
    }

    // Fetch ranking and results in parallel
    const [rankingRes, resultsRes] = await Promise.all([
      fetch(`${API_BASE}/${leagueId}/ranking`, { headers, mode: "cors" }).catch(() => null),
      fetch(`${API_BASE}/${leagueId}/results?skip=0&take=100`, { headers, mode: "cors" }).catch(() => null),
    ]);

    // Parse ranking
    const ranking: RankingEntry[] = [];
    if (rankingRes?.ok) {
      const rankingData = await rankingRes.json();
      if (rankingData?.teams) {
        for (const t of rankingData.teams) {
          ranking.push({
            position: t.position || 0,
            team: t.name || "",
            played: (t.won || 0) + (t.draw || 0) + (t.lost || 0),
            won: t.won || 0,
            drawn: t.draw || 0,
            lost: t.lost || 0,
            goalsFor: t.goalsFor || 0,
            goalsAgainst: t.goalsAgainst || 0,
            goalDifference: (t.goalsFor || 0) - (t.goalsAgainst || 0),
            points: t.points || 0,
          });
        }
      }
    }

    // Parse results
    const results: MatchResult[] = [];
    if (resultsRes?.ok) {
      const resultsData = await resultsRes.json();
      if (resultsData?.rounds) {
        for (const rd of resultsData.rounds) {
          for (const m of rd.matches || []) {
            const score = String(m.score || "0:0").split(":");
            results.push({
              home: m.homeTeam?.name || "",
              away: m.awayTeam?.name || "",
              scoreHome: parseInt(score[0]) || 0,
              scoreAway: parseInt(score[1]) || 0,
              league: leagueName,
              matchday: String(rd.roundNumber || ""),
            });
          }
        }
      }
    }

    return { matches, results, ranking };
  } catch (err) {
    console.error("API fetch error:", err);
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
  const [autoScrapeActive, setAutoScrapeActive] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState<LeagueId>("8035");
  const [dataSource, setDataSource] = useState<"api" | "cache" | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedLeague: LeagueInfo = AVAILABLE_LEAGUES.find(l => l.id === selectedLeagueId) || AVAILABLE_LEAGUES[0];

  // Charger les données depuis Supabase (cache)
  const loadFromDatabase = useCallback(async (leagueName?: string) => {
    const targetLeague = leagueName || selectedLeague.name;
    console.log(`📦 Loading from cache: ${targetLeague}`);

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

      setLastUpdate(rawData[0]?.scraped_at || new Date().toISOString());
      setDataSource("cache");
      return true;
    } catch (err) {
      console.error("Cache error:", err);
      return false;
    }
  }, [selectedLeague]);

  // Charger les données - API d'abord, puis cache
  const fetchMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    console.log(`🚀 Fetching ${selectedLeague.name} (ID: ${selectedLeagueId})`);

    // Try API first
    const apiData = await fetchFromAPI(selectedLeagueId, selectedLeague.name);

    if (apiData && apiData.matches.length > 0) {
      console.log(`✅ API: ${apiData.matches.length} matches, ${apiData.results.length} results, ${apiData.ranking.length} teams`);
      setMatches(apiData.matches);
      setResults(apiData.results);
      setRanking(apiData.ranking);
      setLastUpdate(new Date().toISOString());
      setDataSource("api");
      setLoading(false);
      return;
    }

    console.log("⚠️ API failed, trying cache...");
    const hasCache = await loadFromDatabase();

    if (!hasCache) {
      setError("Aucune donnée. Vérifiez votre connexion.");
    }

    setLoading(false);
  }, [selectedLeagueId, selectedLeague.name, loadFromDatabase]);

  // Refresh manuel
  const refreshData = useCallback(async () => {
    setScraping(true);
    await fetchMatches();
    setScraping(false);
  }, [fetchMatches]);

  // Auto-refresh
  const startAutoRefresh = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setAutoScrapeActive(true);
    fetchMatches();
    intervalRef.current = setInterval(() => fetchMatches(), 30000);
  }, [fetchMatches]);

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
    setSelectedLeagueId(leagueId);

    setMatches([]);
    setResults([]);
    setRanking([]);
    setError(null);
    setLastUpdate(null);
    setDataSource(null);

    if (newLeague) {
      setLoading(true);

      // Try API first
      const apiData = await fetchFromAPI(leagueId, newLeague.name);

      if (apiData && apiData.matches.length > 0) {
        setMatches(apiData.matches);
        setResults(apiData.results);
        setRanking(apiData.ranking);
        setLastUpdate(new Date().toISOString());
        setDataSource("api");
      } else {
        // Fallback to cache
        const hasCache = await loadFromDatabase(newLeague.name);
        if (!hasCache) {
          setError(`Aucune donnée pour ${newLeague.name}`);
        }
      }

      setLoading(false);
    }
  }, [autoScrapeActive, stopAutoRefresh, loadFromDatabase]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

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
    autoScrapeActive,
    geoBlocked: false,
    selectedLeagueId,
    selectedLeague,
    availableLeagues: AVAILABLE_LEAGUES,
    fetchMatches,
    refreshData,
    startAutoRefresh,
    stopAutoRefresh,
    changeLeague,
    dataSource,
  };
}
