import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_BASE = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues";

const LEAGUES: Record<string, string> = {
  "8035": "English League",
  "8060": "Coupe d'Afrique",
  "8056": "Champions League",
  "8036": "Italian League",
  "8037": "Spanish League",
  "8042": "French League",
  "8043": "German League",
  "8044": "Portuguese League",
};

const HEADERS = {
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
};

async function fetchAPI(path: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: HEADERS });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const leagueId = url.searchParams.get("leagueId") || "8035";
    const leagueName = LEAGUES[leagueId] || "Unknown League";

    // Fetch all data in parallel
    const [matchesData, rankingData, resultsData] = await Promise.all([
      fetchAPI(`/${leagueId}/matches`),
      fetchAPI(`/${leagueId}/ranking`),
      fetchAPI(`/${leagueId}/results?skip=0&take=200`),
    ]);

    if (!matchesData) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch matches" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse matches
    const matches: any[] = [];
    if (matchesData?.rounds) {
      for (const rd of matchesData.rounds) {
        const roundNum = rd.roundNumber || 0;
        for (const m of rd.matches || []) {
          let oddHome = 0, oddDraw = 0, oddAway = 0;
          
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

          if (oddHome > 0 || oddAway > 0) {
            matches.push({
              id: m.id,
              home: m.homeTeam?.name || "",
              away: m.awayTeam?.name || "",
              round: roundNum,
              league: leagueName,
              status: "upcoming",
              kickoff: m.expectedStart || "",
              oddHome,
              oddDraw,
              oddAway,
            });
          }
        }
      }
    }

    // Parse ranking
    const ranking: any[] = [];
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
          points: t.points || 0,
        });
      }
    }

    // Parse results
    const results: any[] = [];
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

    return new Response(
      JSON.stringify({
        success: true,
        league: leagueName,
        leagueId,
        matches,
        ranking,
        results,
        scrapedAt: new Date().toISOString(),
        counts: { matches: matches.length, ranking: ranking.length, results: results.length },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
