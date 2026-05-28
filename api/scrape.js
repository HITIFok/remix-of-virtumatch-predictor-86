// Vercel Serverless Function - Scraper
// Correct field names: shortName ("1", "X", "2") and odds (number)

const API_BASE = process.env.SPORTY_API_BASE || "";
const LEAGUE_ID = "8035";

const HEADERS = {
  "Origin": process.env.API_ORIGIN || "",
  "Referer": process.env.API_REFERER || "",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  "App-Version": process.env.API_APP_VERSION || "",
};

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

module.exports = async function handler(req, res) {
  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end('');
    return;
  }

  if (!API_BASE) {
    return res.status(200).json({ success: false, error: "Server not configured", matches: [], ranking: [], results: [] });
  }

  const API_MATCHES = `${API_BASE}/${LEAGUE_ID}/matches`;
  const API_RANKING = `${API_BASE}/${LEAGUE_ID}/ranking`;
  const API_RESULTS = `${API_BASE}/${LEAGUE_ID}/results?skip=0&take=100`;

  const sendJson = (status, data) => {
    res.status(status).json(data);
  };

  try {
    // Fetch all data in parallel
    const [matchesRes, rankingRes, resultsRes] = await Promise.all([
      fetch(API_MATCHES, { headers: HEADERS }),
      fetch(API_RANKING, { headers: HEADERS }),
      fetch(API_RESULTS, { headers: HEADERS }),
    ]);

    // Check for geo-blocking
    if (matchesRes.status === 403 || rankingRes.status === 403 || resultsRes.status === 403) {
      return sendJson(200, {
        success: false,
        error: "Accès bloqué - Proxy non autorisé",
        geoBlocked: true,
        matches: [],
        ranking: [],
        results: [],
      });
    }

    if (!matchesRes.ok || !rankingRes.ok || !resultsRes.ok) {
      return sendJson(200, {
        success: false,
        error: `Erreur HTTP: matches=${matchesRes.status}, ranking=${rankingRes.status}, results=${resultsRes.status}`,
        matches: [],
        ranking: [],
        results: [],
      });
    }

    // Parse JSON responses
    const matchesData = await matchesRes.json();
    const rankingData = await rankingRes.json();
    const resultsData = await resultsRes.json();

    // Parse matches - CORRECTED: use shortName and odds
    const matches = [];
    if (matchesData?.rounds) {
      for (const round of matchesData.rounds) {
        if (round.matches) {
          for (const m of round.matches) {
            // Extraire les cotes depuis eventBetTypes
            let oddHome = 0, oddDraw = 0, oddAway = 0;

            const eventBetTypes = m.eventBetTypes || [];
            for (const betType of eventBetTypes) {
              if (betType.name === "1X2") {
                const items = betType.eventBetTypeItems || [];
                for (const item of items) {
                  const shortName = (item.shortName || "").toUpperCase();
                  const odds = item.odds || 0;

                  // CORRECTION: shortName est "1", "X", "2"
                  if (shortName === "1") {
                    oddHome = odds;
                  } else if (shortName === "X") {
                    oddDraw = odds;
                  } else if (shortName === "2") {
                    oddAway = odds;
                  }
                }
                break; // Trouvé 1X2, on sort
              }
            }

            matches.push({
              league: "Instant League",
              home: m.homeTeam?.name || "",
              away: m.awayTeam?.name || "",
              kickoff: m.expectedStart || "",
              oddHome: oddHome,
              oddDraw: oddDraw,
              oddAway: oddAway,
              status: "upcoming",
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
          played: (t.won || 0) + (t.lost || 0) + (t.draw || 0),
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
      for (const round of resultsData.rounds) {
        if (round.matches) {
          for (const m of round.matches) {
            const scoreParts = (m.score || "0:0").split(":");
            results.push({
              league: "Instant League",
              home: m.homeTeam?.name || "",
              away: m.awayTeam?.name || "",
              scoreHome: parseInt(scoreParts[0]) || 0,
              scoreAway: parseInt(scoreParts[1]) || 0,
              matchday: round.name || "",
            });
          }
        }
      }
    }

    return sendJson(200, {
      success: true,
      matches,
      ranking,
      results,
      scrapedAt: new Date().toISOString(),
      counts: {
        matches: matches.length,
        ranking: ranking.length,
        results: results.length,
      },
    });

  } catch (error) {
    console.error('Scrape error:', error);
    return sendJson(200, {
      success: false,
      error: error.message || "Erreur inconnue",
      matches: [],
      ranking: [],
      results: [],
    });
  }
};
