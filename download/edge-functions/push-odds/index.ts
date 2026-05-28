// push-odds/index.ts — Supabase Edge Function
// Pushes user odds input to predictions table
// ZERO imports to avoid WORKER_ERROR

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const body = await req.json();

    if (!body || !body.matches || !Array.isArray(body.matches)) {
      return new Response(
        JSON.stringify({ success: false, error: 'No matches array provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing env vars' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];
    for (const match of body.matches) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/predictions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            user_id: body.userId || match.userId,
            match_id: match.matchId || match.match_id,
            home_team: match.homeTeam || match.home_team,
            away_team: match.awayTeam || match.away_team,
            predicted_home_score: match.homeScore ?? match.home_score,
            predicted_away_score: match.awayScore ?? match.away_score,
            home_odds: match.homeOdds ?? match.home_odds,
            away_odds: match.awayOdds ?? match.away_odds,
            draw_odds: match.drawOdds ?? match.draw_odds,
            created_at: new Date().toISOString(),
          }),
        });

        if (res.ok) {
          results.push({ matchId: match.matchId, success: true });
        } else {
          const err = await res.text();
          results.push({ matchId: match.matchId, success: false, error: err });
        }
      } catch (e: any) {
        results.push({ matchId: match.matchId, success: false, error: e.message });
      }
    }

    const successCount = results.filter((r: any) => r.success).length;
    return new Response(
      JSON.stringify({ success: true, total: results.length, saved: successCount, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('push-odds error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
