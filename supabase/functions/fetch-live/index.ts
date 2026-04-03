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

// ============================================================
// CACHE en mémoire des eventCategoryIds par ligue.
// Persiste entre les appels dans la même instance Deno (cold start).
// Évite de scanner à chaque requête — cause du "CPU Time exceeded".
// ============================================================
const eventCategoryCache: Record<string, { id: string; ts: number }> = {};
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Requête API avec timeout AbortController.
 * Supabase Free: ~400ms CPU max. Chaque fetch doit être rapide.
 */
async function fetchAPI(path: string, timeoutMs = 6000): Promise<any> {
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
    return null;
  }
}

/**
 * Tente de trouver l'eventCategoryId en scannant UNE SEULE FOIS
 * avec un budget CPU très limité (max 20 IDs testés).
 * Le résultat est mis en cache pour 10 minutes.
 */
async function findEventCategoryId(leagueId: string): Promise<string | null> {
  // 1. Vérifier le cache d'abord
  const cached = eventCategoryCache[leagueId];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    console.log(`📌 eventCategoryId (cache): ${cached.id}`);
    return cached.id;
  }

  // 2. Essayer d'extraire l'eventCategoryId depuis les données de matchs
  const matchesData = await fetchAPI(`/${leagueId}/matches`, 5000);
  if (matchesData?.rounds) {
    for (const rd of matchesData.rounds) {
      // L'API retourne souvent eventCategoryId dans les données de ronde
      if (rd.eventCategoryId) {
        const id = String(rd.eventCategoryId);
        eventCategoryCache[leagueId] = { id, ts: Date.now() };
        console.log(`📌 eventCategoryId (from matches): ${id}`);
        return id;
      }
      // Vérifier dans les matchs
      for (const m of rd.matches || []) {
        if (m.eventCategoryId) {
          const id = String(m.eventCategoryId);
          eventCategoryCache[leagueId] = { id, ts: Date.now() };
          console.log(`📌 eventCategoryId (from match): ${id}`);
          return id;
        }
      }
    }
  }

  // 3. Scan minimal : 20 IDs max autour de la valeur connue
  // Pour English League: ~137840, pour les autres ligues on essaie des plages réduites
  const knownRanges: Record<string, number[]> = {
    "8035": [137840, 137841, 137842, 137843, 137844, 137845, 137846, 137847, 137848, 137849],
    "8060": [137840, 137841, 137842, 137843, 137844, 137845],
    "8056": [137830, 137831, 137832, 137833, 137834, 137835],
    "8036": [137850, 137851, 137852, 137853, 137854, 137855],
    "8037": [137855, 137856, 137857, 137858, 137859, 137860],
    "8042": [137860, 137861, 137862, 137863, 137864, 137865],
    "8043": [137865, 137866, 137867, 137868, 137869, 137870],
    "8044": [137870, 137871, 137872, 137873, 137874, 137875],
  };

  const candidates = knownRanges[leagueId] || [];

  if (candidates.length > 0) {
    // Scanner par batch de 6 en parallèle max
    const batchSize = 6;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (id) => {
          const data = await fetchAPI(`/round/8?eventCategoryId=${id}&getNext=false`, 3000);
          return { id, found: data?.matches && data.matches.length > 0 };
        })
      );
      const found = results.find(r => r.found);
      if (found) {
        eventCategoryCache[leagueId] = { id: String(found.id), ts: Date.now() };
        console.log(`📌 eventCategoryId (scan): ${found.id}`);
        return String(found.id);
      }
    }
  }

  console.log(`📌 eventCategoryId: non trouvé (mis en cache négatif pour 5 min)`);
  // Mettre en cache négatif pour éviter de rescanner à chaque appel
  eventCategoryCache[leagueId] = { id: "__none__", ts: Date.now() };
  return null;
}

/**
 * Récupère les matchs en direct (playout).
 * Max 10 rondes en parallèle pour rester dans le budget CPU.
 */
async function fetchLiveData(leagueId: string, eventCategoryId: string): Promise<Map<number, any>> {
  const liveMatches = new Map();

  // Rondes 1 à 10 (couverture large avec budget CPU minimal)
  const rounds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const roundResults = await Promise.allSettled(
    rounds.map(roundNum =>
      fetchAPI(
        `/round/${roundNum}/playout?eventCategoryId=${eventCategoryId}&parentEventCategoryId=${leagueId}`,
        4000,
      )
    )
  );

  for (const result of roundResults) {
    if (result.status !== "fulfilled" || !result.value?.matches) continue;
    for (const m of result.value.matches) {
      const goals = m.goals || [];
      if (goals.length > 0) {
        const lastGoal = goals[goals.length - 1];
        liveMatches.set(m.id, {
          scoreHome: lastGoal.homeScore || 0,
          scoreAway: lastGoal.awayScore || 0,
          minute: lastGoal.minute || 0,
          goals: goals,
        });
      }
    }
  }

  console.log(`🔴 LIVE matches: ${liveMatches.size}`);
  return liveMatches;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const leagueId = url.searchParams.get("leagueId") || "8035";
    const leagueName = LEAGUES[leagueId] || "Unknown League";

    console.log(`=== 🔄 League ${leagueId} (${leagueName}) ===`);

    // Trouver l'eventCategoryId (cache ou scan minimal)
    const eventCategoryId = await findEventCategoryId(leagueId);
    console.log(`📌 eventCategoryId: ${eventCategoryId}`);

    // Récupérer les données en parallèle (max 4 requêtes simultanées)
    const [matchesData, rankingData, resultsData, liveMatches] = await Promise.all([
      fetchAPI(`/${leagueId}/matches`),
      fetchAPI(`/${leagueId}/ranking`),
      fetchAPI(`/${leagueId}/results?skip=0&take=200`),
      eventCategoryId && eventCategoryId !== "__none__"
        ? fetchLiveData(leagueId, eventCategoryId)
        : Promise.resolve(new Map()),
    ]);

    if (!matchesData) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch matches" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Identifier les matchs terminés depuis les résultats
    const finishedMatchIds = new Set<number>();
    if (resultsData?.rounds) {
      for (const rd of resultsData.rounds) {
        for (const m of rd.matches || []) {
          if (m.id) finishedMatchIds.add(m.id);
        }
      }
    }

    const matches: any[] = [];
    let liveCount = 0, bettingCount = 0, finishedCount = 0;

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

          let status = "upcoming";
          let scoreHome: number | null = null;
          let scoreAway: number | null = null;
          let minute: number | null = null;
          let goals: any[] | null = null;

          if (finishedMatchIds.has(m.id)) {
            status = "finished";
            finishedCount++;
          } else if (liveMatches.has(m.id)) {
            const liveInfo = liveMatches.get(m.id)!;
            status = "live";
            scoreHome = liveInfo.scoreHome;
            scoreAway = liveInfo.scoreAway;
            minute = liveInfo.minute;
            goals = liveInfo.goals;
            liveCount++;
          } else {
            const hasActiveBetting = m.eventBetTypes?.some((bt: any) =>
              bt.eventBetTypeItems?.some((it: any) => it.active && it.bettingAllowed)
            );
            if (hasActiveBetting || oddHome > 0) {
              status = "betting";
              bettingCount++;
            }
          }

          matches.push({
            id: m.id, home: m.homeTeam?.name || "", away: m.awayTeam?.name || "",
            round: roundNum, league: leagueName, status, kickoff: m.expectedStart || "",
            oddHome, oddDraw, oddAway, scoreHome, scoreAway, minute, goals,
          });
        }
      }
    }

    console.log(`=== 📊 live=${liveCount}, betting=${bettingCount}, finished=${finishedCount} ===`);

    // Parser le classement
    const ranking: any[] = [];
    if (rankingData?.teams) {
      for (const t of rankingData.teams) {
        ranking.push({
          position: t.position || 0, team: t.name || "",
          played: (t.won || 0) + (t.draw || 0) + (t.lost || 0),
          won: t.won || 0, drawn: t.draw || 0, lost: t.lost || 0,
          goalsFor: t.goalsFor || 0, goalsAgainst: t.goalsAgainst || 0,
          points: t.points || 0,
        });
      }
    }

    // Parser les résultats
    const results: any[] = [];
    if (resultsData?.rounds) {
      for (const rd of resultsData.rounds) {
        for (const m of rd.matches || []) {
          const score = String(m.score || "0:0").split(":");
          results.push({
            home: m.homeTeam?.name || "", away: m.awayTeam?.name || "",
            scoreHome: parseInt(score[0]) || 0, scoreAway: parseInt(score[1]) || 0,
            league: leagueName, matchday: String(rd.roundNumber || ""),
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true, league: leagueName, leagueId, eventCategoryId,
        matches, ranking, results, liveCount, bettingCount, finishedCount,
        scrapedAt: new Date().toISOString(),
        counts: { matches: matches.length, ranking: ranking.length, results: results.length },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
