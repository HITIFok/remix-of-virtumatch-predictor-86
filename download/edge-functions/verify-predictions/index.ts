// verify-predictions/index.ts — Supabase Edge Function
// Verifies user predictions against scraped_data results
// ZERO imports to avoid WORKER_ERROR

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization');

    // Read body
    let body: any = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      // Empty body — return default response
      return new Response(
        JSON.stringify({ success: true, verified: [], total: 0, correct: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const predictions = body.predictions || body.matches || [];
    if (!Array.isArray(predictions) || predictions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, verified: [], total: 0, correct: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Supabase env vars' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch scraped_data for these match IDs
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    };
    if (authHeader) headers['Authorization'] = authHeader;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/scraped_data?select=match_id,home_team,away_team,home_score,away_score,status`, {
      headers,
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ success: true, verified: [], total: predictions.length, correct: 0, note: 'Could not fetch scraped_data' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const scrapedMatches = await res.json();
    const scrapedMap = new Map(scrapedMatches.map((m: any) => [m.match_id, m]));

    const verified = predictions.map((pred: any) => {
      const scraped = scrapedMap.get(pred.matchId || pred.match_id);
      let isCorrect = false;

      if (scraped && scraped.status === 'finished') {
        const predictedHome = pred.homeScore ?? pred.home_score;
        const predictedAway = pred.awayScore ?? pred.away_score;

        if (predictedHome != null && predictedAway != null) {
          isCorrect = Number(predictedHome) === Number(scraped.home_score) &&
                      Number(predictedAway) === Number(scraped.away_score);
        }
      }

      return {
        matchId: pred.matchId || pred.match_id,
        homeTeam: pred.homeTeam || pred.home_team,
        awayTeam: pred.awayTeam || pred.away_team,
        predictedHome: pred.homeScore ?? pred.home_score,
        predictedAway: pred.awayScore ?? pred.away_score,
        actualHome: scraped?.home_score ?? null,
        actualAway: scraped?.away_score ?? null,
        status: scraped?.status || 'pending',
        isCorrect,
      };
    });

    const correct = verified.filter((v: any) => v.isCorrect).length;

    return new Response(
      JSON.stringify({
        success: true,
        verified,
        total: verified.length,
        correct,
        accuracy: verified.length > 0 ? Math.round((correct / verified.length) * 100) : 0,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('verify-predictions error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
