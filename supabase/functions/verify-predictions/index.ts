// Supabase Edge Function: verify-predictions
// Vérifie les prédictions en attente en récupérant les résultats de TOUTES les ligues

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const DATABASE_URL = Deno.env.get('DATABASE_URL')!
const DATABASE_SERVICE_KEY = Deno.env.get('DATABASE_SERVICE_KEY')!

const API_BASE = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues"

// Toutes les ligues
const LEAGUES = [
  { id: "8035", name: "English League" },
  { id: "8060", name: "Coupe d'Afrique" },
  { id: "8056", name: "Champions League" },
  { id: "8036", name: "Italian League" },
  { id: "8037", name: "Spanish League" },
  { id: "8042", name: "French League" },
  { id: "8043", name: "German League" },
  { id: "8044", name: "Portuguese League" },
]

const HEADERS = {
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json",
}

// CORS headers - restreint aux origins autorisées
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').filter(Boolean);
const DEFAULT_ORIGIN = ''; // Définir votre domaine de production ici

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : DEFAULT_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
    'Content-Type': 'application/json'
  };
}

async function fetchResults(leagueId: string): Promise<Map<string, { homeScore: number, awayScore: number, outcome: string, league: string }>> {
  const resultsMap = new Map<string, { homeScore: number, awayScore: number, outcome: string, league: string }>()

  try {
    const response = await fetch(`${API_BASE}/${leagueId}/results?skip=0&take=200`, { headers: HEADERS })

    if (!response.ok) {
      console.log(`⚠️ League ${leagueId}: API returned ${response.status}`)
      return resultsMap
    }

    const data = await response.json()

    if (data.rounds) {
      for (const roundData of data.rounds) {
        for (const match of (roundData.matches || [])) {
          const homeTeam = match.homeTeam?.name
          const awayTeam = match.awayTeam?.name
          const score = match.score || "0:0"
          const parts = score.split(":")
          const homeScore = parseInt(parts[0]) || 0
          const awayScore = parseInt(parts[1]) || 0

          let outcome: string
          if (homeScore > awayScore) outcome = '1'
          else if (homeScore < awayScore) outcome = '2'
          else outcome = 'X'

          if (homeTeam && awayTeam) {
            resultsMap.set(`${homeTeam}|${awayTeam}`, { homeScore, awayScore, outcome, league: LEAGUES.find(l => l.id === leagueId)?.name || 'Unknown' })
          }
        }
      }
    }

    console.log(`✅ League ${leagueId}: ${resultsMap.size} results`)
  } catch (err) {
    console.log(`❌ League ${leagueId}: ${err.message}`)
  }

  return resultsMap
}

serve(async (req) => {
  // Handle CORS preflight
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  console.log('🔍 Verify predictions called')

  const supabase = createClient(DATABASE_URL, DATABASE_SERVICE_KEY)

  try {
    // 1. Récupérer les prédictions en attente
    const { data: pendingPredictions, error: fetchError } = await supabase
      .from('predictions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(100)

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch predictions', details: fetchError.message }),
        { status: 500, headers: corsHeaders }
      )
    }

    console.log(`📋 Found ${pendingPredictions?.length || 0} pending predictions`)

    if (!pendingPredictions || pendingPredictions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'Aucune prédiction à vérifier', verified: 0 }),
        { status: 200, headers: corsHeaders }
      )
    }

    // 2. Récupérer les résultats de TOUTES les ligues en parallèle
    console.log('🌐 Fetching results from ALL leagues...')
    const allResults = await Promise.all(LEAGUES.map(l => fetchResults(l.id)))

    // Combiner tous les résultats
    const resultsMap = new Map<string, { homeScore: number, awayScore: number, outcome: string, league: string }>()
    for (const leagueResults of allResults) {
      for (const [key, value] of leagueResults) {
        resultsMap.set(key, value)
      }
    }

    console.log(`📊 Total results: ${resultsMap.size}`)

    // 3. Comparer et mettre à jour
    let correct = 0
    let incorrect = 0
    const updates: Promise<any>[] = []

    for (const pred of pendingPredictions) {
      const key = `${pred.home_team}|${pred.away_team}`
      const result = resultsMap.get(key)

      if (result) {
        const isCorrect = pred.prediction === result.outcome
        const status = isCorrect ? 'correct' : 'incorrect'

        if (isCorrect) correct++
        else incorrect++

        updates.push(
          supabase
            .from('predictions')
            .update({
              actual_home_score: result.homeScore,
              actual_away_score: result.awayScore,
              actual_outcome: result.outcome,
              actual_score: `${result.homeScore}:${result.awayScore}`,
              status: status,
              verified_at: new Date().toISOString()
            })
            .eq('id', pred.id)
        )

        console.log(`${isCorrect ? '✅' : '❌'} ${pred.home_team} vs ${pred.away_team}: predicted ${pred.prediction}, actual ${result.outcome} (${result.league})`)
      }
    }

    // Exécuter les mises à jour avec Promise.allSettled pour logger les erreurs individuelles
    const settledResults = await Promise.allSettled(updates)
    let failedUpdates = 0;
    for (const result of settledResults) {
      if (result.status === 'rejected') {
        failedUpdates++;
        console.error('Failed update:', result.reason);
      }
    }

    console.log(`🎉 Verification complete: ${correct} correct, ${incorrect} incorrect, ${failedUpdates} failed`)

    return new Response(
      JSON.stringify({
        success: true,
        verified: settledResults.filter(r => r.status === 'fulfilled').length,
        correct,
        incorrect,
        failedUpdates,
        stillPending: pendingPredictions.length - updates.length,
        totalResults: resultsMap.size
      }),
      { status: 200, headers: corsHeaders }
    )

  } catch (error) {
    console.error('💥 Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    )
  }
})
