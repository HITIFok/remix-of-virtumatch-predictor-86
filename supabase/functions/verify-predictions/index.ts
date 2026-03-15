// Supabase Edge Function: verify-predictions
// Vérifie les prédictions en attente et les compare aux résultats réels

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const LEAGUE_ID = "8035"
const API_RESULTS = `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE_ID}/results?skip=0&take=50`

const HEADERS = {
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
}

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-cron-key, apikey',
  'Content-Type': 'application/json'
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    // Vérification d'autorisation simplifiée
    const authHeader = req.headers.get('Authorization')
    const cronKey = req.headers.get('x-cron-key')
    const apikey = req.headers.get('apikey')
    
    // Accepter plusieurs formes d'autorisation
    const isAuthorized = 
      cronKey === 'bet261_cron_2024' ||
      cronKey === Deno.env.get('CRON_SECRET') ||
      authHeader === `Bearer ${SUPABASE_SERVICE_KEY}` ||
      authHeader === `Bearer ${SUPABASE_ANON_KEY}` ||
      apikey === SUPABASE_ANON_KEY ||
      (authHeader?.startsWith('Bearer eyJ') ?? false) // JWT tokens

    if (!isAuthorized) {
      console.log('Unauthorized request. Headers:', {
        auth: authHeader?.substring(0, 30),
        cronKey,
        apikey: apikey?.substring(0, 10)
      })
      return new Response(
        JSON.stringify({ error: 'Unauthorized', hint: 'Include apikey header or Authorization bearer token' }),
        { status: 401, headers: corsHeaders }
      )
    }

    console.log('Starting prediction verification...')

    // 1. Récupérer les prédictions en attente
    const { data: pendingPredictions, error: fetchError } = await supabase
      .from('predictions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50)

    if (fetchError) {
      console.error('Error fetching predictions:', fetchError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch predictions', details: fetchError.message }),
        { status: 500, headers: corsHeaders }
      )
    }

    if (!pendingPredictions || pendingPredictions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No pending predictions to verify', verified: 0 }),
        { status: 200, headers: corsHeaders }
      )
    }

    console.log(`Found ${pendingPredictions.length} pending predictions`)

    // 2. Récupérer les résultats réels de l'API
    const response = await fetch(API_RESULTS, { headers: HEADERS })
    
    if (!response.ok) {
      console.error('API error:', response.status, response.statusText)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch results from API', status: response.status }),
        { status: 500, headers: corsHeaders }
      )
    }

    const resultsData = await response.json()

    // Construire un map des résultats
    const resultsMap = new Map<string, { homeScore: number, awayScore: number, outcome: string }>()

    if (resultsData.rounds) {
      for (const roundData of resultsData.rounds) {
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
            resultsMap.set(`${homeTeam}|${awayTeam}`, { homeScore, awayScore, outcome })
          }
        }
      }
    }

    console.log(`Found ${resultsMap.size} results in API`)

    // 3. Comparer et mettre à jour les prédictions
    const updates: Promise<any>[] = []
    let correct = 0
    let incorrect = 0

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
      }
    }

    // Exécuter les mises à jour
    await Promise.all(updates)

    console.log(`Verification complete: ${correct} correct, ${incorrect} incorrect`)

    return new Response(
      JSON.stringify({
        success: true,
        verified: updates.length,
        correct,
        incorrect,
        stillPending: pendingPredictions.length - updates.length
      }),
      { status: 200, headers: corsHeaders }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message, stack: error.stack }),
      { status: 500, headers: corsHeaders }
    )
  }
})
