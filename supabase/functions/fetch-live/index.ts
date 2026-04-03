import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_BASE = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues";

// Configuration des ligues avec eventCategoryId pour les matchs en direct
const LEAGUES: Record<string, { name: string; eventCategoryId?: string }> = {
  "8035": { name: "English League", eventCategoryId: "137844" },
  "8060": { name: "Coupe d'Afrique", eventCategoryId: "137840" },
  "8056": { name: "Champions League" },
  "8036": { name: "Italian League" },
  "8037": { name: "Spanish League" },
  "8042": { name: "French League" },
  "8043": { name: "German League" },
  "8044": { name: "Portuguese League" },
};

const HEADERS = {
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
};

/**
 * Requête API avec timeout (AbortController).
 * Retourne null en cas d'erreur ou de timeout — dégradation gracieuse.
 */
async function fetchAPI(path: string, timeoutMs = 8000): Promise<any> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${API_BASE}${path}`, {
      headers: HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Timeout, erreur réseau, ou API injoignable → on ignore silencieusement
    return null;
  }
}

/**
 * Récupère les matchs en direct depuis les rondes récentes (35-42).
 * Utilise Promise.allSettled pour le traitement parallèle.
 */
async function fetchLiveMatches(
  leagueId: string,
  eventCategoryId?: string,
): Promise<Map<number, { scoreHome: number; scoreAway: number; minute: number; goals: any[] }>> {
  const liveData = new Map<number, { scoreHome: number; scoreAway: number; minute: number; goals: any[] }>();

  if (!eventCategoryId) return liveData;

  // Rondes 35 à 42 (8 rondes max au lieu de 16) — traitées en parallèle
  const roundPromises = [];
  for (let roundNum = 35; roundNum <= 42; roundNum++) {
    roundPromises.push(
      fetchAPI(
        `/round/${roundNum}/playout?eventCategoryId=${eventCategoryId}&parentEventCategoryId=${leagueId}`,
        6000, // Timeout plus court (6s) pour les requêtes live
      ),
    );
  }

  const results = await Promise.allSettled(roundPromises);

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value?.matches) continue;
    for (const m of result.value.matches) {
      const goals = m.goals || [];
      if (goals.length > 0) {
        const lastGoal = goals[goals.length - 1];
        liveData.set(m.id, {
          scoreHome: lastGoal.homeScore || 0,
          scoreAway: lastGoal.awayScore || 0,
          minute: lastGoal.minute || 0,
          goals: goals,
        });
      }
    }
  }

  return liveData;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const leagueId = url.searchParams.get("leagueId") || "8035";
    const leagueInfo = LEAGUES[leagueId] || { name: "Unknown League" };
    const leagueName = leagueInfo.name;

    // Récupération parallèle : matchs, classement, résultats et données live
    const [matchesData, rankingData, resultsData, liveData] = await Promise.all([
      fetchAPI(`/${leagueId}/matches`),
      fetchAPI(`/${leagueId}/ranking`),
      fetchAPI(`/${leagueId}/results?skip=0&take=200`),
      fetchLiveMatches(leagueId, leagueInfo.eventCategoryId),
    ]);

    // Dégradation gracieuse : si l'API principale échoue, on retourne des données vides
    // au lieu d'une erreur 5xx, pour que le frontend puisse afficher le cache
    if (!matchesData) {
      return new Response(
        JSON.stringify({
          success: true,
          league: leagueName,
          leagueId,
          matches: [],
          ranking: rankingData ? parseRanking(rankingData) : [],
          results: resultsData ? parseResults(resultsData, leagueName) : [],
          liveCount: 0,
          scrapedAt: new Date().toISOString(),
          counts: { matches: 0, ranking: 0, results: 0 },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse les matchs
    const matches: any[] = [];
    let liveCount = 0;

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

          // Vérifie si le match est en direct
          const liveInfo = liveData.get(m.id);
          const isLive = liveInfo !== undefined;
          if (isLive) liveCount++;

          // Statut : live, betting, ou upcoming
          let status = "upcoming";
          if (isLive) {
            status = "live";
          } else if (oddHome > 0 || oddAway > 0) {
            const hasActiveBetting = m.eventBetTypes?.some((bt: any) =>
              bt.eventBetTypeItems?.some((it: any) => it.active && it.bettingAllowed)
            );
            if (hasActiveBetting) status = "betting";
          }

          matches.push({
            id: m.id,
            home: m.homeTeam?.name || "",
            away: m.awayTeam?.name || "",
            round: roundNum,
            league: leagueName,
            status: status,
            kickoff: m.expectedStart || "",
            oddHome,
            oddDraw,
            oddAway,
            scoreHome: liveInfo?.scoreHome ?? null,
            scoreAway: liveInfo?.scoreAway ?? null,
            minute: liveInfo?.minute ?? null,
            goals: liveInfo?.goals ?? null,
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
        ranking: parseRanking(rankingData),
        results: parseResults(resultsData, leagueName),
        liveCount,
        scrapedAt: new Date().toISOString(),
        counts: { matches: matches.length, ranking: parseRanking(rankingData).length, results: parseResults(resultsData, leagueName).length },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (error) {
    // Dernier recours : retourner un succès avec données vides plutôt qu'une erreur 5xx
    return new Response(
      JSON.stringify({
        success: true,
        league: "Unknown",
        leagueId: "",
        matches: [],
        ranking: [],
        results: [],
        liveCount: 0,
        scrapedAt: new Date().toISOString(),
        counts: { matches: 0, ranking: 0, results: 0 },
        fallback: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// --- Fonctions utilitaires de parsing ---

/** Parse le classement depuis la réponse API */
function parseRanking(data: any): any[] {
  if (!data?.teams) return [];
  return data.teams.map((t: any) => ({
    position: t.position || 0,
    team: t.name || "",
    played: (t.won || 0) + (t.draw || 0) + (t.lost || 0),
    won: t.won || 0,
    drawn: t.draw || 0,
    lost: t.lost || 0,
    goalsFor: t.goalsFor || 0,
    goalsAgainst: t.goalsAgainst || 0,
    points: t.points || 0,
  }));
}

/** Parse les résultats depuis la réponse API */
function parseResults(data: any, leagueName: string): any[] {
  if (!data?.rounds) return [];
  const results: any[] = [];
  for (const rd of data.rounds) {
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
  return results;
}
