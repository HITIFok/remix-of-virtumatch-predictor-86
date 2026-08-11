// Vercel Serverless Function - Proxy API
// Source unique : sporty-tech API (temps réel)
// Supports 8 leagues via ?leagueId=8035

import { setCorsHeaders } from './_lib/cors.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const SPORTY_API_BASE = process.env.SPORTY_API_BASE || '';

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

// ─── Handler principal ─────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, POST, OPTIONS', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const leagueId = req.query.leagueId || "8035";

  // SSRF protection: only allow known league IDs
  if (!LEAGUES[leagueId]) {
    return res.status(400).json({ success: false, error: "Invalid leagueId" });
  }
  const leagueName = LEAGUES[leagueId];

  try {
    // ─── sporty-tech API (temps réel) ──────────────────────────────
    if (!SPORTY_API_BASE) {
      return res.status(200).json({
        success: false,
        error: 'SPORTY_API_BASE non configuré',
        league: leagueName,
        leagueId,
        matches: [],
        ranking: [],
        results: [],
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const [matchesRes, rankingRes, resultsRes] = await Promise.all([
      fetch(`${SPORTY_API_BASE}/${leagueId}/matches`, { headers: SPORTY_HEADERS, signal: controller.signal }),
      fetch(`${SPORTY_API_BASE}/${leagueId}/ranking`, { headers: SPORTY_HEADERS, signal: controller.signal }),
      fetch(`${SPORTY_API_BASE}/${leagueId}/results?skip=0&take=200`, { headers: SPORTY_HEADERS, signal: controller.signal }),
    ]);
    clearTimeout(timeoutId);

    if (matchesRes.status === 403) {
      return res.status(200).json({
        success: false,
        error: `API temporairement indisponible pour ${leagueName}`,
        league: leagueName,
        leagueId,
        matches: [],
        ranking: [],
        results: [],
      });
    }

    if (!matchesRes.ok) {
      return res.status(200).json({
        success: false,
        error: 'Erreur API',
        league: leagueName,
        leagueId,
        matches: [],
        ranking: [],
        results: [],
      });
    }

    const matchesData = await matchesRes.json();
    const rankingData = rankingRes.ok ? await rankingRes.json() : { teams: [] };
    const resultsData = resultsRes.ok ? await resultsRes.json() : { rounds: [] };

    const matches = parseSportyMatches(matchesData, leagueName);
    const ranking = parseSportyRanking(rankingData);
    const results = parseSportyResults(resultsData, leagueName);

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

  } catch (err) {
    console.error('[matches] Erreur:', err.message);
    return res.status(200).json({
      success: false,
      error: 'Erreur serveur temporaire',
      league: leagueName,
      leagueId,
      matches: [],
      ranking: [],
      results: [],
    });
  }
};
