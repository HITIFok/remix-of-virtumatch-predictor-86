// fetch-live/index.ts — Supabase Edge Function
// Fetches live match data from sporty-tech.net API
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

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const leagueId = url.searchParams.get('leagueId') || '8035';

    // Step 1: Get league info to find current round
    let currentRound = 0;
    try {
      const info = await fetchJSON(`${API_BASE}/api/instantleagues/${leagueId}/info`);
      currentRound = info?.currentRound || info?.round || info?.data?.currentRound || 0;
    } catch (e) {
      console.log('Info fetch failed, trying direct round approach');
    }

    // Step 2: Get matches list
    let matches: any[] = [];
    try {
      const matchData = await fetchJSON(`${API_BASE}/api/instantleagues/${leagueId}/matches`);
      // Handle different response structures
      if (Array.isArray(matchData)) {
        matches = matchData;
      } else if (matchData?.data && Array.isArray(matchData.data)) {
        matches = matchData.data;
      } else if (matchData?.matches && Array.isArray(matchData.matches)) {
        matches = matchData.matches;
      } else if (matchData?.events && Array.isArray(matchData.events)) {
        matches = matchData.events;
      } else if (matchData?.result && Array.isArray(matchData.result)) {
        matches = matchData.result;
      } else {
        // Try to extract any array from the response
        for (const key of Object.keys(matchData || {})) {
          if (Array.isArray(matchData[key]) && matchData[key].length > 0) {
            matches = matchData[key];
            break;
          }
        }
      }
    } catch (e: any) {
      console.error('Matches fetch failed:', e.message);
    }

    // Step 3: If we have a round, try to get live playout data
    let liveData: any[] = [];
    if (currentRound > 0) {
      try {
        const playout = await fetchJSON(
          `${API_BASE}/api/instantleagues/round/${currentRound}/playout?parentEventCategoryId=${leagueId}`
        );
        if (Array.isArray(playout)) {
          liveData = playout;
        } else if (playout?.data && Array.isArray(playout.data)) {
          liveData = playout.data;
        } else if (playout?.matches && Array.isArray(playout.matches)) {
          liveData = playout.matches;
        } else if (playout?.events && Array.isArray(playout.events)) {
          liveData = playout.events;
        } else {
          for (const key of Object.keys(playout || {})) {
            if (Array.isArray(playout[key])) {
              liveData = playout[key];
              break;
            }
          }
        }

        // Merge live data into matches if we have both
        if (liveData.length > 0 && matches.length > 0) {
          const liveMap = new Map(liveData.map((m: any) => [m.id || m.matchId, m]));
          matches = matches.map((m: any) => {
            const live = liveMap.get(m.id || m.matchId);
            return live ? { ...m, ...live, isLive: true } : m;
          });
        } else if (liveData.length > 0) {
          matches = liveData;
        }
      } catch (e: any) {
        console.error('Playout fetch failed:', e.message);
      }
    }

    // Ensure matches is ALWAYS an array (frontend expects .map())
    if (!Array.isArray(matches)) {
      matches = [];
    }

    return new Response(
      JSON.stringify({
        matches,
        live: liveData.length > 0 ? liveData : undefined,
        round: currentRound,
        leagueId,
        totalMatches: matches.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('fetch-live error:', error.message);
    // Always return 200 with empty array to prevent frontend crash
    return new Response(
      JSON.stringify({ matches: [], live: [], error: error.message }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
