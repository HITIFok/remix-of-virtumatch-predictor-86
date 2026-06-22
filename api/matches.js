// Vercel Serverless Function - Proxy API with Supabase fallback
// Primaire : sporty-tech API (temps réel)
// Secondaire : Supabase scraped_data table (cache)
// Supports 8 leagues via ?leagueId=8035

const { createClient } = require('@supabase/supabase-js');

// ─── Configuration ────────────────────────────────────────────────────────────

const SPORTY_API_BASE = process.env.SPORTY_API_BASE || '';
const DATABASE_URL = process.env.VITE_DATABASE_URL || process.env.DATABASE_URL;
const DATABASE_SERVICE_KEY = process.env.DATABASE_SERVICE_KEY;

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

const SPORTY_HEADERS = {
  "Origin": process.env.API_ORIGIN || '',
  "Referer": process.env.API_REFERER || '',
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
  "App-Version": process.env.API_APP_VERSION || '',
};

const ALLOWED_ORIGINS = [
  "https://virtual-match-hitifproject.vercel.app",
  "https://remix-of-virtumatch-predictor-86.vercel.app",
];

// ─── Parsing : sporty-tech API response → app format ────────────────────────

function parseSportyMatches(matchesData, leagueName) {
  const matches = [];
  if (!matchesData?.rounds) return matches;

  for (const rd of matchesData.rounds) {
    const roundNum = rd.roundNumber || 0;
    for (const m of rd.matches || []) {
      let oddHome = 0, oddDraw = 0, oddAway = 0;

      for (const bt of m.eventBetTypes || []) {
        if (bt.name === '1X2') {
          for (const it of bt.eventBetTypeItems || []) {
            const sn = (it.shortName || '').toUpperCase();
            const val = parseFloat(it.odds) || 0;
            if (sn === '1') oddHome = val;
            else if (sn === 'X') oddDraw = val;
            else if (sn === '2') oddAway = val;
          }
          break;
        }
      }

      if (oddHome > 0 || oddAway > 0) {
        matches.push({
          id: m.id,
          home: m.homeTeam?.name || '',
          away: m.awayTeam?.name || '',
          round: roundNum,
          league: leagueName,
          status: 'upcoming',
          kickoff: m.expectedStart || '',
          oddHome, oddDraw, oddAway,
        });
      }
    }
  }
  return matches;
}

function parseSportyRanking(rankingData) {
  const ranking = [];
  if (!rankingData?.teams) return ranking;

  for (const t of rankingData.teams) {
    ranking.push({
      position: t.position || 0,
      team: t.name || '',
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
  return ranking;
}

function parseSportyResults(resultsData, leagueName) {
  const results = [];
  if (!resultsData?.rounds) return results;

  for (const rd of resultsData.rounds) {
    for (const m of rd.matches || []) {
      const score = String(m.score || '0:0').split(':');
      results.push({
        home: m.homeTeam?.name || '',
        away: m.awayTeam?.name || '',
        scoreHome: parseInt(score[0]) || 0,
        scoreAway: parseInt(score[1]) || 0,
        league: leagueName,
        matchday: String(rd.roundNumber || ''),
      });
    }
  }
  return results;
}

// ─── Supabase fallback : lire scraped_data table ──────────────────────────

async function fetchFromSupabaseCache(leagueName) {
  if (!DATABASE_URL || !DATABASE_SERVICE_KEY) {
    console.error('[matches] DATABASE_URL ou DATABASE_SERVICE_KEY manquant');
    return null;
  }

  const supabase = createClient(DATABASE_URL, DATABASE_SERVICE_KEY);

  const { data, error } = await supabase
    .from('scraped_data')
    .select('*')
    .eq('league', leagueName)
    .order('scraped_at', { ascending: false });

  if (error) {
    console.error('[matches] Supabase cache error:', error.message);
    return null;
  }

  if (!data || data.length === 0) {
    console.warn('[matches] Aucune donnée en cache pour:', leagueName);
    return null;
  }

  const matchesEntry = data.find(d => d.data_type === 'matches');
  const resultsEntry = data.find(d => d.data_type === 'results');
  const rankingEntry = data.find(d => d.data_type === 'ranking');

  const matches = (matchesEntry?.payload && Array.isArray(matchesEntry.payload))
    ? matchesEntry.payload.map(m => ({
        id: m.id,
        home: m.home || '',
        away: m.away || '',
        round: m.round,
        league: m.league || leagueName,
        status: m.status || 'upcoming',
        kickoff: m.kickoff || m.expectedStart || '',
        oddHome: m.oddHome || 0,
        oddDraw: m.oddDraw || 0,
        oddAway: m.oddAway || 0,
      }))
    : [];

  const results = (resultsEntry?.payload && Array.isArray(resultsEntry.payload))
    ? resultsEntry.payload.map(r => ({
        home: r.home || '',
        away: r.away || '',
        scoreHome: r.scoreHome ?? 0,
        scoreAway: r.scoreAway ?? 0,
        league: r.league || leagueName,
        matchday: r.matchday || '',
      }))
    : [];

  const ranking = (rankingEntry?.payload && Array.isArray(rankingEntry.payload))
    ? rankingEntry.payload.map(t => ({
        position: t.position || 0,
        team: t.team || t.name || '',
        played: t.played || 0,
        won: t.won || 0,
        drawn: t.drawn || t.draw || 0,
        lost: t.lost || 0,
        goalsFor: t.goalsFor || 0,
        goalsAgainst: t.goalsAgainst || 0,
        goalDifference: (t.goalsFor || 0) - (t.goalsAgainst || 0),
        points: t.points || 0,
      }))
    : [];

  const scrapedAt = matchesEntry?.scraped_at || data[0]?.scraped_at || null;

  return { matches, results, ranking, scrapedAt };
}

// ─── Handler principal ─────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // Dynamic CORS: only allow configured origins + same-host
  const origin = req.headers.origin || "";
  const reqHost = req.headers.host || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || (origin && (() => { try { return new URL(origin).hostname === reqHost; } catch { return false; } })());
  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const leagueId = req.query.leagueId || "8035";

  // SSRF protection: only allow known league IDs (numeric only)
  if (!LEAGUES[leagueId]) {
    return res.status(400).json({ success: false, error: "Invalid leagueId" });
  }
  const leagueName = LEAGUES[leagueId];

  try {
    // ─── Source 1 : sporty-tech API (temps réel) ────────────────────────────
    if (SPORTY_API_BASE) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const [matchesRes, rankingRes, resultsRes] = await Promise.all([
          fetch(`${SPORTY_API_BASE}/${leagueId}/matches`, { headers: SPORTY_HEADERS, signal: controller.signal }),
          fetch(`${SPORTY_API_BASE}/${leagueId}/ranking`, { headers: SPORTY_HEADERS, signal: controller.signal }),
          fetch(`${SPORTY_API_BASE}/${leagueId}/results?skip=0&take=200`, { headers: SPORTY_HEADERS, signal: controller.signal }),
        ]);
        clearTimeout(timeoutId);

        // Succès API
        if (matchesRes.ok && matchesRes.status !== 403) {
          const matchesData = await matchesRes.json();
          const rankingData = rankingRes.ok ? await rankingRes.json() : { teams: [] };
          const resultsData = resultsRes.ok ? await resultsRes.json() : { rounds: [] };

          const matches = parseSportyMatches(matchesData, leagueName);
          const ranking = parseSportyRanking(rankingData);
          const results = parseSportyResults(resultsData, leagueName);

          if (matches.length > 0) {
            return res.status(200).json({
              success: true,
              source: 'api',
              league: leagueName,
              leagueId,
              matches,
              ranking,
              results,
              scrapedAt: new Date().toISOString(),
              counts: { matches: matches.length, ranking: ranking.length, results: results.length },
            });
          }
          console.warn(`[matches] sporty-tech OK mais 0 matchs pour ${leagueName}, fallback cache`);
        }

        if (matchesRes.status === 403) {
          console.warn(`[matches] sporty-tech geo-blocké pour ${leagueName}, fallback cache`);
        }

      } catch (apiErr) {
        console.error(`[matches] sporty-tech échoué pour ${leagueName}:`, apiErr.message);
      }
    } else {
      console.warn('[matches] SPORTY_API_BASE non configuré, utilisation du cache Supabase uniquement');
    }

    // ─── Source 2 : Supabase scraped_data (cache) ────────────────────────────
    const cacheData = await fetchFromSupabaseCache(leagueName);

    if (cacheData && cacheData.matches.length > 0) {
      return res.status(200).json({
        success: true,
        source: 'cache',
        league: leagueName,
        leagueId,
        matches: cacheData.matches,
        results: cacheData.results,
        ranking: cacheData.ranking,
        scrapedAt: cacheData.scrapedAt,
        counts: {
          matches: cacheData.matches.length,
          ranking: cacheData.ranking.length,
          results: cacheData.results.length,
        },
      });
    }

    // ─── Aucune source disponible ────────────────────────────────────────────
    return res.status(200).json({
      success: false,
      source: 'none',
      error: `Aucune donnée disponible pour ${leagueName}. L'API est temporairement indisponible et le cache est vide.`,
      league: leagueName,
      leagueId,
      matches: [],
      ranking: [],
      results: [],
    });

  } catch (err) {
    console.error('[matches] Erreur inattendue:', err.message);
    return res.status(200).json({
      success: false,
      source: 'none',
      error: 'Erreur serveur temporaire',
      league: leagueName,
      leagueId,
      matches: [],
      ranking: [],
      results: [],
    });
  }
};
