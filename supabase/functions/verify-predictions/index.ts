// Supabase Edge Function: verify-predictions
// Vérifie les prédictions en attente et les compare aux résultats réels
// SANS autorisation complexe - appelé depuis l'app frontend

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const LEAGUE_ID = "8035"
const API_RESULTS = `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE_ID}/results?skip=0&take=50`

const HEADERS = {
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0",
  "Accept": "application/json",
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Content-Type': 'application/json'
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  console.log('🔍 Verify predictions called - Method:', req.method)

  // Utiliser le client avec la clé anon (pas besoin de service_role pour lire)
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  try {
    console.log('📊 Fetching pending predictions...')

    // 1. Récupérer les prédictions en attente
    const { data: pendingPredictions, error: fetchError } = await supabase
      .from('predictions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50)

    if (fetchError) {
      console.error('❌ Error fetching predictions:', fetchError)
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

    // 2. Récupérer les résultats depuis l'API
    console.log('🌐 Fetching results from API...')
    const response = await fetch(API_RESULTS, { headers: HEADERS })
    
    if (!response.ok) {
      console.error('❌ API error:', response.status)
      return new Response(
        JSON.stringify({ error: `API error: ${response.status}`, hint: 'API may be geo-blocked from Supabase servers' }),
        { status: 500, headers: corsHeaders }
      )
    }

    const resultsData = await response.json()
    console.log('✅ API response received')

    // 3. Construire le map des résultats
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

    console.log(`📊 Found ${resultsMap.size} results in API`)

    // 4. Comparer et mettre à jour
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

        console.log(`${isCorrect ? '✅' : '❌'} ${pred.home_team} vs ${pred.away_team}: predicted ${pred.prediction}, actual ${result.outcome}`)
      }
    }

    // Exécuter les mises à jour
    await Promise.all(updates)

    console.log(`🎉 Verification complete: ${correct} correct, ${incorrect} incorrect`)

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
    console.error('💥 Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    )
  }
})
