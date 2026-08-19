// Vercel Serverless Function — fetch-live v17 (ESM)
// Converted from Supabase Edge Function (Deno) to Vercel (Node.js)
// Fetches live match data, ranking, results from sporty-tech.net API
// v17: Multi-round playout scan + team names in quick-results + Tier 1/2 cross-validation

import { setCorsHeaders } from './_lib/cors.js';

const SPORTY_API_BASE = process.env.SPORTY_API_BASE || '';

const LEAGUES = {
  '8035': 'English League',
  '8060': "Coupe d'Afrique",
  '8056': 'Champions League',
  '8036': 'Italian League',
  '8037': 'Spanish League',
  '8042': 'French League',
  '8043': 'German League',
  '8044': 'Portuguese League',
  '8065': 'Coupe du monde',
};

const HEADERS = {
  'Origin': process.env.API_ORIGIN || '',
  'Referer': process.env.API_REFERER || '',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'App-Version': process.env.API_APP_VERSION || '',
};

const CONF_BEARER = process.env.SPORTY_BEARER || '';
const API_HEADERS = CONF_BEARER
  ? { ...HEADERS, 'Authorization': `Bearer ${CONF_BEARER}` }
  : HEADERS;

async function fetchAPI(path, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${SPORTY_API_BASE}${path}`, {
      headers: API_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.log(`API ${res.status} for ${path}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`fetchAPI error for ${path}: ${e.message}`);
    return null;
  }
}

// v13: Extract Correct Score prediction from "Score exact" market odds
function extractScoreExactPrediction(match) {
  try {
    for (const bt of match.eventBetTypes || []) {
      const name = (bt.name || '').toLowerCase();
      if (
        (name.includes('score') && name.includes('exact')) ||
        (name.includes('score') && name.includes('correct'))
      ) {
        if (name.includes('mi-tps') || name.includes('2') || name.includes('ht') || name.includes('half')) {
          continue;
        }

        const items = bt.eventBetTypeItems || [];
        if (items.length === 0) continue;

        const sorted = [...items].sort(
          (a, b) => parseFloat(a.odds || 999) - parseFloat(b.odds || 999)
        );

        const parseScore = (sn) => {
          const cleaned = sn.replace(/\s/g, '').replace('-', ':');
          const parts = cleaned.split(':');
          if (parts.length === 2) {
            return { home: parseInt(parts[0]) || 0, away: parseInt(parts[1]) || 0 };
          }
          return { home: 0, away: 0 };
        };

        const top3 = sorted.slice(0, 3).map((it) => {
          const parsed = parseScore(it.shortName || '');
          return {
            score: `${parsed.home}-${parsed.away}`,
            home: parsed.home,
            away: parsed.away,
            odds: parseFloat(it.odds) || 0,
          };
        });

        const best = top3[0];
        if (!best || (best.home === 0 && best.away === 0)) continue;

        return {
          predictedHome: best.home,
          predictedAway: best.away,
          odds: best.odds,
          topScores: top3,
        };
      }
    }
  } catch (e) {
    // Silently skip
  }
  return null;
}

// Fetch playout for a specific round (requires eventCategoryId from matches data)
async function fetchPlayout(leagueId, round, eventCategoryId) {
  const playoutMatches = new Map();
  try {
    const params = `parentEventCategoryId=${leagueId}`;
    const catParams = eventCategoryId ? `&eventCategoryId=${eventCategoryId}` : '';
    const data = await fetchAPI(
      `/round/${round}/playout?${params}${catParams}`,
      3000
    );
    if (data?.matches && Array.isArray(data.matches)) {
      for (const m of data.matches) {
        const matchId = m.id;
        const goals = m.goals || [];
        if (matchId) {
          const lastGoal = goals.length > 0 ? goals[goals.length - 1] : null;
          playoutMatches.set(matchId, {
            scoreHome: lastGoal ? (lastGoal.homeScore || 0) : 0,
            scoreAway: lastGoal ? (lastGoal.awayScore || 0) : 0,
            minute: lastGoal ? (lastGoal.minute || 0) : 90,
            goals: goals,
            homeTeam: m.homeTeam?.name || '',
            awayTeam: m.awayTeam?.name || '',
          });
        }
      }
      console.log(`[Sporty] Playout round ${round}: ${playoutMatches.size} results`);
    } else {
      console.log(`[Sporty] Playout round ${round}: empty (0 matches)`);
    }
  } catch (e) {
    console.log(`[Sporty] Playout error round ${round}: ${e.message}`);
  }
  return playoutMatches;
}

export default async function handler(req, res) {
  // CORS (shared module — no wildcard)
  setCorsHeaders(req, res, 'GET, POST, OPTIONS', 'Content-Type, Authorization, x-device-id');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  const startTime = Date.now();

  try {
    // Read leagueId from query params OR POST body
    let leagueId = req.query.leagueId || '';
    let bodyMode = '';

    if (!leagueId) {
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        leagueId = body?.leagueId || '8035';
        bodyMode = body?.mode || '';
      } catch {
        leagueId = '8035';
      }
    }

    // Validate leagueId against known leagues (same as api/matches.js)
    if (!LEAGUES[leagueId]) {
      return res.status(400).json({ success: false, error: 'Invalid leagueId' });
    }

    const leagueName = LEAGUES[leagueId] || 'Unknown League';
    const mode = req.query.mode || bodyMode;
    console.log(`=== fetch-live v17: ${leagueName} (${leagueId}) ===`);

    // === QUICK-RESULTS MODE (v16) ===
    if (mode === 'quick-results') {
      const matchesResp = await fetchAPI(`/${leagueId}/matches`, 5000);
      if (!matchesResp?.rounds) {
        return res.status(200).json({
          success: true, mode: 'quick-results', league: leagueName, leagueId,
          playoutResults: [], bettingRound: 0, hasResults: false,
          elapsed: Date.now() - startTime,
        });
      }

      let qBettingRound = 0;
      let qNextRoundStart = null;
      const qBettingMatchIds = new Set();
      for (const rd of matchesResp.rounds) {
        for (const m of rd.matches || []) {
          const hasBetting = m.eventBetTypes?.some((bt) =>
            bt.eventBetTypeItems?.some((it) => it.active && it.bettingAllowed)
          );
          if (hasBetting) qBettingMatchIds.add(m.id);
        }
        const hasBettingMatch = (rd.matches || []).some((m) => qBettingMatchIds.has(m.id));
        if (hasBettingMatch && !qBettingRound) {
          qBettingRound = rd.roundNumber || 0;
          qNextRoundStart = rd.expectedStart || null;
        }
      }

      // v17: Build round→eventCategoryId map for ALL rounds (not just betting)
      const qRoundCatMap = new Map();
      for (const rd of matchesResp.rounds) {
        if (rd.roundNumber && rd.eventCategoryId) {
          qRoundCatMap.set(rd.roundNumber, rd.eventCategoryId);
        }
      }
      let qEventCategoryId = qRoundCatMap.get(qBettingRound) || null;

      // v17: Scan up to 3 recent rounds in playout for earliest possible detection
      const qRoundsDesc = matchesResp.rounds
        ?.filter(rd => rd.roundNumber)
        .sort((a, b) => b.roundNumber - a.roundNumber) || [];
      const qPlayoutRounds = qRoundsDesc.slice(0, 3).map(rd => rd.roundNumber);

      const allQPlayout = new Map();
      if (qPlayoutRounds.length > 0) {
        const qResults = await Promise.allSettled(
          qPlayoutRounds.map(r => fetchPlayout(leagueId, r, qRoundCatMap.get(r)))
        );
        for (const result of qResults) {
          if (result.status === 'fulfilled') {
            for (const [id, data] of result.value) {
              allQPlayout.set(id, data);
            }
          }
        }
      }

      // Build matchId→matchInfo map for team name resolution
      const qMatchInfo = new Map();
      for (const rd of matchesResp.rounds) {
        for (const m of rd.matches || []) {
          if (m.id) {
            qMatchInfo.set(m.id, {
              homeTeam: m.homeTeam?.name || '',
              awayTeam: m.awayTeam?.name || '',
            });
          }
        }
      }

      const qPreloaded = [];
      for (const [matchId, pData] of allQPlayout) {
        if (qBettingMatchIds.has(matchId)) {
          const info = qMatchInfo.get(matchId);
          qPreloaded.push({
            matchId,
            ...pData,
            homeTeam: pData.homeTeam || info?.homeTeam || '',
            awayTeam: pData.awayTeam || info?.awayTeam || '',
          });
        }
      }

      const hasResults = qPreloaded.length > 0;
      console.log(`[quick-results] bettingRound=${qBettingRound}, bettingMatches=${qBettingMatchIds.size}, preloaded=${qPreloaded.length}, playoutRoundsChecked=${qPlayoutRounds} (${Date.now() - startTime}ms)`);

      return res.status(200).json({
        success: true, mode: 'quick-results', league: leagueName, leagueId,
        bettingRound: qBettingRound, bettingMatchCount: qBettingMatchIds.size,
        nextRoundStart: qNextRoundStart,
        playoutResults: qPreloaded, playoutCount: qPreloaded.length,
        hasResults,
        elapsed: Date.now() - startTime,
        scrapedAt: new Date().toISOString(),
      });
    }

    // === LIGHTWEIGHT PLOAYOUT MODE ===
    if (mode === 'playout') {
      const roundStr = req.query.round;
      if (!roundStr) {
        return res.status(200).json({ success: false, error: 'round parameter required for playout mode', playoutResults: [] });
      }
      const round = parseInt(roundStr);
      if (isNaN(round) || round <= 0) {
        return res.status(200).json({ success: false, error: 'invalid round', playoutResults: [] });
      }

      // For standalone playout mode, eventCategoryId must come from matches data
      // We fetch matches first to get it
      let standaloneEventCategoryId = null;
      const matchesForCat = await fetchAPI(`/${leagueId}/matches`, 5000);
      if (matchesForCat?.rounds) {
        for (const rd of matchesForCat.rounds) {
          if (rd.roundNumber === round) {
            standaloneEventCategoryId = rd.eventCategoryId || null;
            break;
          }
        }
      }
      const playoutData = await fetchPlayout(leagueId, round, standaloneEventCategoryId);
      const playoutResults = [];
      for (const [id, data] of playoutData) {
        playoutResults.push({ matchId: id, ...data });
      }

      return res.status(200).json({
        success: true, mode: 'playout', league: leagueName, leagueId,
        round, playoutResults, playoutCount: playoutResults.length,
        scrapedAt: new Date().toISOString(),
      });
    }

    // === FULL MODE ===
    console.log(`[Sporty] Fetching ${leagueName} (${leagueId})`);

    const [matchesData, rankingData, resultsData] = await Promise.all([
      fetchAPI(`/${leagueId}/matches`),
      fetchAPI(`/${leagueId}/ranking`),
      fetchAPI(`/${leagueId}/results?skip=0&take=200`),
    ]);

    if (!matchesData) {
      return res.status(200).json({
        success: false, error: 'API unavailable',
        matches: [], results: [], ranking: [],
      });
    }

    // === TWO-TIER EARLY DATA SYSTEM ===
    const bettingMatchIds = new Set();
    const allRoundNumbers = new Set();
    let nextRoundStart = null;
    let bettingRound = null;

    if (matchesData?.rounds) {
      for (const rd of matchesData.rounds) {
        const roundNum = rd.roundNumber || 0;
        if (roundNum > 0) allRoundNumbers.add(roundNum);
        for (const m of rd.matches || []) {
          const hasActiveBetting = m.eventBetTypes?.some((bt) =>
            bt.eventBetTypeItems?.some((it) => it.active && it.bettingAllowed)
          );
          if (hasActiveBetting) bettingMatchIds.add(m.id);
        }
      }
    }

    if (matchesData?.rounds) {
      for (const rd of matchesData.rounds) {
        const roundNum = rd.roundNumber || 0;
        const hasBettingMatch = (rd.matches || []).some((m) => bettingMatchIds.has(m.id));
        if (hasBettingMatch && roundNum > 0) {
          bettingRound = roundNum;
          nextRoundStart = rd.expectedStart || null;
          break;
        }
      }
    }

    // Step 2: Extract Correct Score predictions (Tier 1)
    const oddsPredictions = new Map();
    if (matchesData?.rounds) {
      for (const rd of matchesData.rounds) {
        for (const m of rd.matches || []) {
          const prediction = extractScoreExactPrediction(m);
          if (prediction && m.id) {
            oddsPredictions.set(m.id, prediction);
          }
        }
      }
    }
    console.log(`[Sporty] Score Exact predictions: ${oddsPredictions.size} matches`);

    // Step 3: Build round→eventCategoryId map from matches data
    const roundEventCatMap = new Map();
    if (matchesData?.rounds) {
      for (const rd of matchesData.rounds) {
        if (rd.roundNumber && rd.eventCategoryId) {
          roundEventCatMap.set(rd.roundNumber, rd.eventCategoryId);
        }
      }
    }

    // Step 4: Fetch playout for active rounds (Tier 2)
    const roundList = [...allRoundNumbers].sort((a, b) => b - a).slice(0, 5);
    const allPlayoutMatches = new Map();
    if (roundList.length > 0) {
      const playoutResults = await Promise.allSettled(
        roundList.map(r => fetchPlayout(leagueId, r, roundEventCatMap.get(r)))
      );
      for (const result of playoutResults) {
        if (result.status === 'fulfilled') {
          for (const [id, data] of result.value) {
            allPlayoutMatches.set(id, data);
          }
        }
      }
    }
    console.log(`[Sporty] Total playout results available: ${allPlayoutMatches.size}`);

    // Step 5: Cross-reference playout with betting matches (EXPLOIT)
    const preloadedMatches = new Map();
    for (const [matchId, playoutData] of allPlayoutMatches) {
      if (bettingMatchIds.has(matchId)) {
        preloadedMatches.set(matchId, playoutData);
      }
    }
    const preloadedCount = preloadedMatches.size;

    // Step 6: Build matches array
    const matches = [];
    let liveCount = 0, bettingCount = 0, finishedCount = 0;

    if (matchesData?.rounds) {
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

          let status = 'upcoming';
          let scoreHome = null;
          let scoreAway = null;
          let minute = null;
          let goals = null;
          let prediction = null;
          let predeterminedScore = null;

          if (preloadedMatches.has(m.id)) {
            const preloaded = preloadedMatches.get(m.id);
            status = 'preloaded';
            scoreHome = preloaded.scoreHome;
            scoreAway = preloaded.scoreAway;
            minute = preloaded.minute;
            goals = preloaded.goals;
            predeterminedScore = {
              home: preloaded.scoreHome,
              away: preloaded.scoreAway,
              minute: preloaded.minute,
            };
            prediction = oddsPredictions.get(m.id) || null;
            // v17: Cross-validate Tier 1 (odds) vs Tier 2 (playout)
            let confirmed = false;
            if (prediction) {
              confirmed = prediction.predictedHome === scoreHome && prediction.predictedAway === scoreAway;
              console.log(`[EXPLOIT] ${m.homeTeam?.name || '?'} vs ${m.awayTeam?.name || '?'} -> ${scoreHome}-${scoreAway} (betting open! rd${roundNum}) Tier1=${prediction.predictedHome}:${prediction.predictedAway} confirmed=${confirmed}`);
            } else {
              console.log(`[EXPLOIT] ${m.homeTeam?.name || '?'} vs ${m.awayTeam?.name || '?'} -> ${scoreHome}-${scoreAway} (betting open! rd${roundNum})`);
            }
          } else if (allPlayoutMatches.has(m.id)) {
            const liveInfo = allPlayoutMatches.get(m.id);
            status = 'live';
            scoreHome = liveInfo.scoreHome;
            scoreAway = liveInfo.scoreAway;
            minute = liveInfo.minute;
            goals = liveInfo.goals;
            liveCount++;
          } else if (bettingMatchIds.has(m.id) || oddHome > 0) {
            status = 'betting';
            bettingCount++;
            prediction = oddsPredictions.get(m.id) || null;
          }

          matches.push({
            id: m.id, home: m.homeTeam?.name || '', away: m.awayTeam?.name || '',
            round: roundNum, league: leagueName, status, kickoff: m.expectedStart || '',
            oddHome, oddDraw, oddAway, scoreHome, scoreAway, minute, goals,
            predeterminedScore: predeterminedScore || null,
            prediction,
          });
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Sporty] ${leagueName}: matches=${matches.length}, ranking=${rankingData?.teams?.length || 0}, results=${resultsData?.rounds?.length || 0}, preloaded=${preloadedCount}, live=${liveCount}, betting=${bettingCount}`);
    console.log(`[Sporty] Total: ${elapsed}ms`);

    // Parse ranking
    const ranking = [];
    if (rankingData?.teams) {
      for (const t of rankingData.teams) {
        ranking.push({
          position: t.position || 0, team: t.name || '',
          played: (t.won || 0) + (t.draw || 0) + (t.lost || 0),
          won: t.won || 0, drawn: t.draw || 0, lost: t.lost || 0,
          goalsFor: t.goalsFor || 0, goalsAgainst: t.goalsAgainst || 0,
          points: t.points || 0,
        });
      }
    }

    // Parse results
    const results = [];
    if (resultsData?.rounds) {
      for (const rd of resultsData.rounds) {
        for (const m of rd.matches || []) {
          const score = String(m.score || '0:0').split(':');
          results.push({
            home: m.homeTeam?.name || '', away: m.awayTeam?.name || '',
            scoreHome: parseInt(score[0]) || 0, scoreAway: parseInt(score[1]) || 0,
            league: leagueName, matchday: String(rd.roundNumber || ''),
          });
        }
      }
    }

    return res.status(200).json({
      success: true, league: leagueName, leagueId,
      matches, ranking, results, liveCount, bettingCount, finishedCount, preloadedCount,
      predictionCount: oddsPredictions.size,
      scrapedAt: new Date().toISOString(),
      counts: { matches: matches.length, ranking: ranking.length, results: results.length },
    });
  } catch (error) {
    console.error('fetch-live error:', error.message);
    return res.status(500).json({
      success: false, error: 'Failed to fetch live data',
      matches: [], results: [], ranking: [],
    });
  }
};
