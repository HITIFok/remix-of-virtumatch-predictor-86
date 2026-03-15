// Supabase Edge Function: verify-predictions
// Vérifie les prédictions en attente et les compare aux résultats réels

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const DATABASE_URL = Deno.env.get('DATABASE_URL')!
const DATABASE_SERVICE_KEY = Deno.env.get('DATABASE_SERVICE_KEY')!

const LEAGUE_ID = "8035"
const API_RESULTS = `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE_ID}/results?skip=0&take=50`

const HEADERS = {
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
}

serve(async (req) => {
  const supabase = createClient(DATABASE_URL, DATABASE_SERVICE_KEY)

  try {
    // Vérifier l'autorisation
    const authHeader = req.headers.get('Authorization')
    const cronKey = req.headers.get('x-cron-key')
    const expectedCronKey = Deno.env.get('CRON_SECRET') || 'bet261_cron_2024'

    const isAuthorized = cronKey === expectedCronKey ||
      authHeader === `Bearer ${DATABASE_SERVICE_KEY}` ||
      authHeader?.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
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
        JSON.stringify({ error: 'Failed to fetch predictions', details: fetchError }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!pendingPredictions || pendingPredictions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No pending predictions to verify' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${pendingPredictions.length} pending predictions`)

    // 2. Récupérer les résultats réels de l'API
    const response = await fetch(API_RESULTS, { headers: HEADERS })
    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch results from API' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
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

          // Indexer par nom des équipes
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

    // 4. Mettre à jour les statistiques
    await supabase.rpc('update_prediction_stats')

    console.log(`Verification complete: ${correct} correct, ${incorrect} incorrect`)

    return new Response(
      JSON.stringify({
        success: true,
        verified: updates.length,
        correct,
        incorrect,
        stillPending: pendingPredictions.length - updates.length
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
