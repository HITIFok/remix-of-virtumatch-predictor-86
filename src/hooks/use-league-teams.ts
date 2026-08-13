import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "@/config/env";
import { AVAILABLE_LEAGUES } from "./use-live-matches";

/**
 * Hook that fetches team names for a given league.
 * Uses the live API (/api/matches?leagueId=xxx) which returns matches, ranking, results.
 *
 * Returns a deduplicated, sorted list of team names plus loading/error state.
 */
export function useLeagueTeams(leagueName: string) {
  const [teams, setTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Record<string, string[]>>({});

  const fetchTeams = useCallback(async (league: string) => {
    if (!league) {
      setTeams([]);
      return;
    }

    // Check memory cache first
    if (cacheRef.current[league]) {
      setTeams(cacheRef.current[league]);
      return;
    }

    // Find leagueId from league name
    const leagueInfo = AVAILABLE_LEAGUES.find(l => l.name === league);
    if (!leagueInfo) {
      setTeams([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/matches?leagueId=${leagueInfo.id}`);
      if (!res.ok) {
        setTeams([]);
        return;
      }

      const data = await res.json();
      const teamSet = new Set<string>();

      // Collect from matches (home/away team names)
      if (Array.isArray(data.matches)) {
        for (const m of data.matches) {
          if (m.home) teamSet.add(m.home);
          if (m.away) teamSet.add(m.away);
        }
      }

      // Collect from ranking (team names with standings)
      if (Array.isArray(data.ranking)) {
        for (const t of data.ranking) {
          if (t.team) teamSet.add(t.team);
        }
      }

      // Collect from results (past match team names)
      if (Array.isArray(data.results)) {
        for (const r of data.results) {
          if (r.home) teamSet.add(r.home);
          if (r.away) teamSet.add(r.away);
        }
      }

      // Sort alphabetically (French locale)
      const sorted = Array.from(teamSet).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      );

      cacheRef.current[league] = sorted;
      setTeams(sorted);
    } catch (err) {
      console.error("[useLeagueTeams] Fetch error:", err);
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams(leagueName);
  }, [leagueName, fetchTeams]);

  return { teams, loading, refetch: () => fetchTeams(leagueName) };
}
