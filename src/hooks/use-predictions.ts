// Hook pour gérer les prédictions et leur suivi de précision
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'

export interface Prediction {
  id: string
  match_id: number | null
  home_team: string
  away_team: string
  league: string
  odd_home: number
  odd_draw: number
  odd_away: number
  prob_home: number
  prob_draw: number
  prob_away: number
  prediction: '1' | 'X' | '2'
  confidence: number
  predicted_home_score: number | null
  predicted_away_score: number | null
  predicted_score: string | null
  actual_home_score: number | null
  actual_away_score: number | null
  actual_outcome: '1' | 'X' | '2' | null
  actual_score: string | null
  status: 'pending' | 'correct' | 'incorrect'
  verified_at: string | null
  created_at: string
}

export interface AggregatedStats {
  total: number
  correct: number
  incorrect: number
  pending: number
  accuracy: number
  byOutcome: {
    home: { predicted: number; correct: number }
    draw: { predicted: number; correct: number }
    away: { predicted: number; correct: number }
  }
  byConfidence: {
    high: { total: number; correct: number }
    medium: { total: number; correct: number }
    low: { total: number; correct: number }
  }
  recentAccuracy: number
}

export function usePredictions() {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [stats, setStats] = useState<AggregatedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Charger les prédictions
  const loadPredictions = useCallback(async () => {
    try {
      setLoading(true)
      
      const { data: predData, error: predError } = await supabase
        .from('predictions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (predError) throw predError

      setPredictions((predData as Prediction[]) || [])

      if (predData && predData.length > 0) {
        const total = predData.length
        const correct = predData.filter(p => p.status === 'correct').length
        const incorrect = predData.filter(p => p.status === 'incorrect').length
        const pending = predData.filter(p => p.status === 'pending').length
        const verified = correct + incorrect
        const accuracy = verified > 0 ? Math.round((correct / verified) * 100) : 0

        const homePred = predData.filter(p => p.prediction === '1')
        const drawPred = predData.filter(p => p.prediction === 'X')
        const awayPred = predData.filter(p => p.prediction === '2')

        const highConf = predData.filter(p => p.confidence >= 70)
        const medConf = predData.filter(p => p.confidence >= 50 && p.confidence < 70)
        const lowConf = predData.filter(p => p.confidence < 50)

        const weekAgo = new Date()
        weekAgo.setDate(weekAgo.getDate() - 7)
        const recentPreds = predData.filter(p => new Date(p.created_at) >= weekAgo)
        const recentVerified = recentPreds.filter(p => p.status !== 'pending')
        const recentCorrect = recentVerified.filter(p => p.status === 'correct').length
        const recentAccuracy = recentVerified.length > 0 
          ? Math.round((recentCorrect / recentVerified.length) * 100) 
          : 0

        setStats({
          total,
          correct,
          incorrect,
          pending,
          accuracy,
          byOutcome: {
            home: { 
              predicted: homePred.length, 
              correct: homePred.filter(p => p.status === 'correct').length 
            },
            draw: { 
              predicted: drawPred.length, 
              correct: drawPred.filter(p => p.status === 'correct').length 
            },
            away: { 
              predicted: awayPred.length, 
              correct: awayPred.filter(p => p.status === 'correct').length 
            },
          },
          byConfidence: {
            high: { 
              total: highConf.length, 
              correct: highConf.filter(p => p.status === 'correct').length 
            },
            medium: { 
              total: medConf.length, 
              correct: medConf.filter(p => p.status === 'correct').length 
            },
            low: { 
              total: lowConf.length, 
              correct: lowConf.filter(p => p.status === 'correct').length 
            },
          },
          recentAccuracy
        })
      }

      setError(null)
    } catch (err) {
      console.error('Error loading predictions:', err)
      setError(err instanceof Error ? err.message : 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [])

  // Sauvegarder une nouvelle prédiction
  const savePrediction = useCallback(async (pred: {
    match_id?: number
    home_team: string
    away_team: string
    league?: string
    odd_home: number
    odd_draw: number
    odd_away: number
    prob_home: number
    prob_draw: number
    prob_away: number
    prediction: '1' | 'X' | '2'
    confidence: number
    predicted_home_score?: number
    predicted_away_score?: number
    predicted_score?: string
  }) => {
    try {
      const { data, error } = await supabase
        .from('predictions')
        .insert({
          ...pred,
          league: pred.league || 'Instant League',
          status: 'pending'
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          console.log('Prediction already exists for this match today')
          return null
        }
        throw error
      }

      await loadPredictions()
      
      return data as Prediction
    } catch (err) {
      console.error('Error saving prediction:', err)
      throw err
    }
  }, [loadPredictions])

  // Vérifier les prédictions - VERSION SIMPLIFIÉE sans Edge Function
  const verifyPredictions = useCallback(async () => {
    try {
      // 1. Récupérer les prédictions en attente
      const { data: pending, error: fetchError } = await supabase
        .from('predictions')
        .select('*')
        .eq('status', 'pending')
        .limit(50)

      if (fetchError) throw fetchError

      if (!pending || pending.length === 0) {
        return { success: true, message: 'Aucune prédiction à vérifier', verified: 0 }
      }

      // 2. Récupérer les résultats depuis l'API (directement depuis le navigateur)
      const LEAGUE_ID = "8035"
      const API_URL = `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE_ID}/results?skip=0&take=50`
      
      const HEADERS = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Origin': 'https://bet261.mg',
        'Referer': 'https://bet261.mg/'
      }

      const response = await fetch(API_URL, { headers: HEADERS })
      
      if (!response.ok) {
        throw new Error(`Erreur API: ${response.status}`)
      }

      const resultsData = await response.json()

      // 3. Construire le map des résultats
      const resultsMap = new Map<string, { homeScore: number, awayScore: number, outcome: string }>()
      
      if (resultsData.rounds) {
        for (const round of resultsData.rounds) {
          for (const m of (round.matches || [])) {
            const home = m.homeTeam?.name
            const away = m.awayTeam?.name
            const score = m.score || "0:0"
            const [h, a] = score.split(":")
            const homeScore = parseInt(h) || 0
            const awayScore = parseInt(a) || 0
            const outcome = homeScore > awayScore ? '1' : homeScore < awayScore ? '2' : 'X'
            
            if (home && away) {
              resultsMap.set(`${home}|${away}`, { homeScore, awayScore, outcome })
            }
          }
        }
      }

      // 4. Comparer et mettre à jour
      let correct = 0
      let incorrect = 0

      for (const pred of pending) {
        const key = `${pred.home_team}|${pred.away_team}`
        const result = resultsMap.get(key)

        if (result) {
          const isCorrect = pred.prediction === result.outcome
          
          if (isCorrect) correct++
          else incorrect++

          await supabase
            .from('predictions')
            .update({
              actual_home_score: result.homeScore,
              actual_away_score: result.awayScore,
              actual_outcome: result.outcome,
              actual_score: `${result.homeScore}:${result.awayScore}`,
              status: isCorrect ? 'correct' : 'incorrect',
              verified_at: new Date().toISOString()
            })
            .eq('id', pred.id)
        }
      }

      // 5. Recharger les prédictions
      await loadPredictions()

      return { 
        success: true, 
        correct, 
        incorrect, 
        verified: correct + incorrect 
      }
    } catch (err) {
      console.error('Error verifying predictions:', err)
      throw err
    }
  }, [loadPredictions])

  // Charger au montage
  useEffect(() => {
    loadPredictions()
  }, [loadPredictions])

  return {
    predictions,
    stats,
    loading,
    error,
    savePrediction,
    verifyPredictions,
    refresh: loadPredictions
  }
}
