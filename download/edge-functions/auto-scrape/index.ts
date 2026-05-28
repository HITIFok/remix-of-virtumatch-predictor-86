// auto-scrape/index.ts — Supabase Edge Function (Cron Job)
// Automatically scrapes odds and updates scraped_data
// Trigger via Supabase Cron: every 5-10 minutes during match hours
// ZERO imports to avoid WORKER_ERROR

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const API_BASE = 'https://hg-event-api-prod.sporty-tech.net';
const API_HEADERS: Record<string, string> = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'App-Version': '33335',
  'Origin': 'https://bet261.mg',
  'Referer': 'https://bet261.mg/',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Leagues to scrape — add more IDs as needed
const LEAGUES = [
  { id: '8035', name: 'English League' },
  // Add more: { id: '8036', name: 'Spanish League' }, etc.
];

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function upsertMatches(matches: any[], leagueId: string, round: number) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return 0;
  }

  // Batch upsert — use native fetch with the Supabase REST API
  const rows = matches.map((match) => ({
    match_id: String(match.id || match.matchId || match.eventId || ''),
    league_id: leagueId,
    round: round,
    home_team: match.homeTeam?.name || match.homeName || match.teamA || match.home || '',
    away_team: match.awayTeam?.name || match.awayName || match.teamB || match.away || '',
    home_score: match.homeScore ?? match.scoreHome ?? match.homeTeamScore ?? null,
    away_score: match.awayScore ?? match.scoreAway ?? match.awayTeamScore ?? null,
    status: match.status || match.matchStatus || match.state || 'upcoming',
    start_time: match.startTime || match.startDate || match.kickoff || match.time || '',
    home_odds: match.oddsHome ?? match.homeOdds ?? match.odds?.home ?? null,
    draw_odds: match.oddsDraw ?? match.drawOdds ?? match.odds?.draw ?? null,
    away_odds: match.oddsAway ?? match.awayOdds ?? match.odds?.away ?? null,
    raw_data: match,
    scraped_at: new Date().toISOString(),
  }));

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scraped_data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Upsert failed for league ${leagueId}:`, errText);
      return 0;
    }

    return rows.length;
  } catch (e: any) {
    console.error(`Upsert error for league ${leagueId}:`, e.message);
    return 0;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const results: any[] = [];

  for (const league of LEAGUES) {
    try {
      // Get current round
      let currentRound = 0;
      try {
        const info = await fetchJSON(`${API_BASE}/api/instantleagues/${league.id}/info`);
        currentRound = info?.currentRound || info?.round || info?.data?.currentRound || 0;
      } catch (e) {
        console.log(`No round info for ${league.name}`);
      }

      // Get matches
      const matchData = await fetchJSON(`${API_BASE}/api/instantleagues/${league.id}/matches`);

      let matches: any[] = [];
      if (Array.isArray(matchData)) {
        matches = matchData;
      } else if (matchData?.data && Array.isArray(matchData.data)) {
        matches = matchData.data;
      } else if (matchData?.matches && Array.isArray(matchData.matches)) {
        matches = matchData.matches;
      } else {
        for (const key of Object.keys(matchData || {})) {
          if (Array.isArray(matchData[key])) {
            matches = matchData[key];
            break;
          }
        }
      }

      // Also try live playout if round is known
      if (currentRound > 0) {
        try {
          const playout = await fetchJSON(
            `${API_BASE}/api/instantleagues/round/${currentRound}/playout?parentEventCategoryId=${league.id}`
          );
          let liveMatches: any[] = [];
          if (Array.isArray(playout)) {
            liveMatches = playout;
          } else if (playout?.data && Array.isArray(playout.data)) {
            liveMatches = playout.data;
          }

          // Merge live data into matches
          if (liveMatches.length > 0) {
            if (matches.length === 0) {
              matches = liveMatches;
            } else {
              const liveMap = new Map(liveMatches.map((m: any) => [m.id || m.matchId, m]));
              matches = matches.map((m: any) => {
                const live = liveMap.get(m.id || m.matchId);
                return live ? { ...m, ...live, isLive: true } : m;
              });
            }
          }
        } catch (e) {
          // Playout not available, that's OK
        }
      }

      // Upsert to DB
      const inserted = await upsertMatches(matches, league.id, currentRound);

      results.push({
        league: league.name,
        leagueId: league.id,
        round: currentRound,
        matchesFound: matches.length,
        upserted: inserted,
        status: 'ok',
      });
    } catch (error: any) {
      console.error(`Auto-scrape failed for ${league.name}:`, error.message);
      results.push({
        league: league.name,
        leagueId: league.id,
        status: 'error',
        error: error.message,
      });
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      leagues: results,
      totalUpserted: results.reduce((sum: number, r: any) => sum + (r.upserted || 0), 0),
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
