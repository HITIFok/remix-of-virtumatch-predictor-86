// analyze-match/index.ts — Supabase Edge Function
// Analyzes a specific match using scraped data + odds
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const matchId = url.searchParams.get('matchId') || '';
    const leagueId = url.searchParams.get('leagueId') || '8035';

    if (!matchId) {
      return new Response(
        JSON.stringify({ success: false, error: 'matchId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch match details from API
    let matchData = null;
    try {
      const res = await fetch(`${API_BASE}/api/instantleagues/${leagueId}/matches`, {
        headers: API_HEADERS,
      });
      if (res.ok) {
        const all = await res.json();
        const matches = Array.isArray(all) ? all : (all?.data || all?.matches || []);
        matchData = matches.find((m: any) =>
          String(m.id || m.matchId) === String(matchId)
        );
      }
    } catch (e: any) {
      console.error('API fetch failed:', e.message);
    }

    // Simple analysis based on available data
    const analysis: any = {
      matchId,
      matchData: matchData || null,
      prediction: null,
      confidence: 0,
    };

    if (matchData) {
      const homeOdds = matchData.oddsHome ?? matchData.homeOdds ?? matchData.odds?.home;
      const awayOdds = matchData.oddsAway ?? matchData.awayOdds ?? matchData.odds?.away;
      const drawOdds = matchData.oddsDraw ?? matchData.drawOdds ?? matchData.odds?.draw;

      if (homeOdds && awayOdds) {
        const totalImplied = (1 / homeOdds + 1 / (drawOdds || 10) + 1 / awayOdds);
        const homeProb = Math.round((1 / homeOdds / totalImplied) * 100);
        const awayProb = Math.round((1 / awayOdds / totalImplied) * 100);
        const drawProb = 100 - homeProb - awayProb;

        let prediction = 'draw';
        let confidence = Math.max(homeProb, awayProb, drawProb);

        if (homeProb > awayProb && homeProb > drawProb) {
          prediction = 'home';
        } else if (awayProb > homeProb && awayProb > drawProb) {
          prediction = 'away';
        }

        analysis.prediction = {
          outcome: prediction,
          confidence,
          probabilities: { home: homeProb, draw: Math.max(0, drawProb), away: awayProb },
        };

        analysis.odds = { home: homeOdds, draw: drawOdds, away: awayOdds };
      }
    }

    return new Response(
      JSON.stringify({ success: true, ...analysis }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('analyze-match error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
