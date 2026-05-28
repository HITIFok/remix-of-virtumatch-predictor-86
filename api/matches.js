// Vercel Serverless Function - Proxy API
// Supports all 9 leagues via ?leagueId=8035 parameter

const API_BASE = process.env.SPORTY_API_BASE || "";

const LEAGUES = {
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
  "Origin": process.env.API_ORIGIN || "",
  "Referer": process.env.API_REFERER || "",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
  "App-Version": process.env.API_APP_VERSION || "",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  const leagueId = req.query.leagueId || "8035";
  const leagueName = LEAGUES[leagueId] || "Unknown League";

  try {
    // Fetch matches, ranking, results in parallel
    const [matchesRes, rankingRes, resultsRes] = await Promise.all([
      fetch(`${API_BASE}/${leagueId}/matches`, { headers: HEADERS }),
      fetch(`${API_BASE}/${leagueId}/ranking`, { headers: HEADERS }),
      fetch(`${API_BASE}/${leagueId}/results?skip=0&take=200`, { headers: HEADERS }),
    ]);

    // Check for geo-blocking
    if (!API_BASE) {
      return res.status(500).json({ success: false, error: "Server not configured" });
    }

    if (matchesRes.status === 403) {
      return res.status(200).json({ success: false, error: "Geo-blocked", geoBlocked: true });
    }

    if (!matchesRes.ok) {
      return res.status(200).json({ success: false, error: `HTTP ${matchesRes.status}` });
    }

    const matchesData = await matchesRes.json();
    const rankingData = rankingRes.ok ? await rankingRes.json() : { teams: [] };
    const resultsData = resultsRes.ok ? await resultsRes.json() : { rounds: [] };

    // Parse matches
    const matches = [];
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
              oddHome, oddDraw, oddAway,
            });
          }
        }
      }
    }

    // Parse ranking
    const ranking = [];
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

    // Parse results
    const results = [];
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

    return res.status(200).json({
      success: true,
      league: leagueName,
      leagueId,
      matches,
      ranking,
      results,
      scrapedAt: new Date().toISOString(),
      counts: { matches: matches.length, ranking: ranking.length, results: results.length },
    });

  } catch (error) {
    return res.status(200).json({ success: false, error: error.message });
  }
};
