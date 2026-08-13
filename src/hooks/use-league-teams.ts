import { useState, useEffect, useCallback, useRef } from "react";
import { config } from "@/config/env";

/**
 * Hook that fetches team names for a given league from the cached matches API.
 * Returns a deduplicated, sorted list of team names plus loading/error state.
 *
 * Data sources per league:
 *   - matches[].home / matches[].away (current round teams)
 *   - ranking[].team (all teams with standings)
 *   - results[].home / results[].away (past match teams)
 */
export function useLeagueTeams(leagueName: string) {
  const [teams, setTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState<Record<string, boolean>>({});
  const cacheRef = useRef<Record<string, string[]>>({});

  const fetchTeams = useCallback(async (league: string) => {
    if (!league || cacheRef.current[league]) {
      setTeams(cacheRef.current[league] || []);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${config.api.scrapedData}?league=${encodeURIComponent(league)}`);
      if (!res.ok) {
        setTeams([]);
        return;
      }

      const json = await res.json();
      const data = json.rows;
      if (!data || !Array.isArray(data)) {
        setTeams([]);
        return;
      }

      const teamSet = new Set<string>();

      for (const entry of data) {
        if (!entry?.payload || !Array.isArray(entry.payload)) continue;

        // Extract team names from all data types
        if (entry.data_type === "matches" || entry.data_type === "results") {
          for (const m of entry.payload) {
            const home = m.home || m.homeTeam?.name || "";
            const away = m.away || m.awayTeam?.name || "";
            if (home) teamSet.add(home);
            if (away) teamSet.add(away);
          }
        }

        if (entry.data_type === "ranking") {
          for (const t of entry.payload) {
            const name = t.team || t.name || "";
            if (name) teamSet.add(name);
          }
        }
      }

      // Sort alphabetically
      const sorted = Array.from(teamSet).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      );

      cacheRef.current[league] = sorted;
      setTeams(sorted);
      setFetched(prev => ({ ...prev, [league]: true }));
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
