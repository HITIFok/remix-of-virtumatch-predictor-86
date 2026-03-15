// Supabase Edge Function: verify-predictions
// Vérifie les prédictions en attente en utilisant les résultats STOCKÉS dans scraped_data
// NE fait PLUS d'appel API direct - utilise les données scrapées par Python/Termux

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const DATABASE_URL = Deno.env.get('DATABASE_URL')!
const DATABASE_SERVICE_KEY = Deno.env.get('DATABASE_SERVICE_KEY')!

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
    console.log('📡 CORS preflight request')
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  console.log('🔍 Verify predictions called - Method:', req.method)

  // Utiliser SERVICE_ROLE pour pouvoir écrire dans predictions
  const supabase = createClient(DATABASE_URL, DATABASE_SERVICE_KEY)

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

    // 2. Récupérer les résultats DEPUIS LA TABLE scraped_data (pas d'appel API !)
    console.log('📦 Fetching results from scraped_data table...')
    
    const { data: scrapedResults, error: scrapeError } = await supabase
      .from('scraped_data')
      .select('payload, scraped_at')
      .eq('data_type', 'results')
      .eq('league', 'Instant League')
      .order('scraped_at', { ascending: false })
      .limit(1)
      .single()

    if (scrapeError || !scrapedResults) {
      console.error('❌ No scraped results found:', scrapeError)
      return new Response(
        JSON.stringify({ 
          error: 'Pas de résultats scrapés disponibles. Exécutez refresh_matches.py depuis Termux.',
          hint: 'Les résultats doivent être scrapés depuis Madagascar'
        }),
        { status: 200, headers: corsHeaders }
      )
    }

    console.log(`✅ Found scraped results from ${scrapedResults.scraped_at}`)

    // 3. Construire le map des résultats depuis le payload
    const resultsMap = new Map<string, { homeScore: number, awayScore: number, outcome: string }>()
    const resultsPayload = scrapedResults.payload as Array<{
      home: string
      away: string
      scoreHome: number
      scoreAway: number
      round: number
      league: string
    }>

    for (const result of resultsPayload) {
      const homeTeam = result.home
      const awayTeam = result.away
      const homeScore = result.scoreHome
      const awayScore = result.scoreAway

      let outcome: string
      if (homeScore > awayScore) outcome = '1'
      else if (homeScore < awayScore) outcome = '2'
      else outcome = 'X'

      if (homeTeam && awayTeam) {
        resultsMap.set(`${homeTeam}|${awayTeam}`, { homeScore, awayScore, outcome })
      }
    }

    console.log(`📊 Found ${resultsMap.size} results in scraped data`)

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
        stillPending: pendingPredictions.length - updates.length,
        scrapedAt: scrapedResults.scraped_at,
        source: 'scraped_data table'
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
