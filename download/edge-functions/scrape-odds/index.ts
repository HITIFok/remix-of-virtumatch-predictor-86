// scrape-odds/index.ts — Supabase Edge Function
// Scrapes match data + odds from sporty-tech.net and inserts into scraped_data
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

// Supabase project details — REPLACE WITH YOUR VALUES
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function upsertScrapedData(matches: any[], leagueId: string, round: number) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    return { success: false, error: 'Missing env vars' };
  }

  const inserted = [];
  const errors = [];

  for (const match of matches) {
    try {
      // Extract match data — adapt field names based on actual API response
      const matchId = String(match.id || match.matchId || match.eventId || '');
      const homeTeam = match.homeTeam?.name || match.homeName || match.teamA || match.home || '';
      const awayTeam = match.awayTeam?.name || match.awayName || match.teamB || match.away || '';
      const homeScore = match.homeScore ?? match.scoreHome ?? match.homeTeamScore ?? null;
      const awayScore = match.awayScore ?? match.scoreAway ?? match.awayTeamScore ?? null;
      const matchStatus = match.status || match.matchStatus || match.state || 'upcoming';
      const startTime = match.startTime || match.startDate || match.kickoff || match.time || '';
      const homeOdds = match.oddsHome ?? match.homeOdds ?? match.odds?.home ?? null;
      const drawOdds = match.oddsDraw ?? match.drawOdds ?? match.odds?.draw ?? null;
      const awayOdds = match.oddsAway ?? match.awayOdds ?? match.odds?.away ?? null;

      // Upsert into scraped_data
      const res = await fetch(`${SUPABASE_URL}/rest/v1/scraped_data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({
          match_id: matchId,
          league_id: leagueId,
          round: round,
          home_team: homeTeam,
          away_team: awayTeam,
          home_score: homeScore,
          away_score: awayScore,
          status: matchStatus,
          start_time: startTime,
          home_odds: homeOdds,
          draw_odds: drawOdds,
          away_odds: awayOdds,
          raw_data: match,
          scraped_at: new Date().toISOString(),
        }),
      });

      if (res.ok) {
        inserted.push(matchId);
      } else {
        const errText = await res.text();
        errors.push({ matchId, error: errText });
      }
    } catch (e: any) {
      errors.push({ matchId: match.id || 'unknown', error: e.message });
    }
  }

  return { success: true, inserted: inserted.length, errors: errors.length, errorDetails: errors };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const leagueId = url.searchParams.get('leagueId') || '8035';

    // Get current round
    let currentRound = 0;
    try {
      const info = await fetchJSON(`${API_BASE}/api/instantleagues/${leagueId}/info`);
      currentRound = info?.currentRound || info?.round || info?.data?.currentRound || 0;
    } catch (e) {
      console.log('Could not fetch round info');
    }

    // Get matches
    const matchData = await fetchJSON(`${API_BASE}/api/instantleagues/${leagueId}/matches`);

    let matches: any[] = [];
    if (Array.isArray(matchData)) {
      matches = matchData;
    } else if (matchData?.data && Array.isArray(matchData.data)) {
      matches = matchData.data;
    } else if (matchData?.matches && Array.isArray(matchData.matches)) {
      matches = matchData.data?.matches || matchData.matches;
    } else {
      for (const key of Object.keys(matchData || {})) {
        if (Array.isArray(matchData[key])) {
          matches = matchData[key];
          break;
        }
      }
    }

    if (matches.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No matches found', inserted: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Upsert all matches into scraped_data
    const result = await upsertScrapedData(matches, leagueId, currentRound);

    return new Response(
      JSON.stringify({
        success: true,
        totalMatches: matches.length,
        round: currentRound,
        leagueId,
        ...result,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('scrape-odds error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
