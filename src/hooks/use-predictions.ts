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

export interface PredictionStats {
  date: string
  total_predictions: number
  correct_predictions: number
  incorrect_predictions: number
  pending_predictions: number
  accuracy: number
  home_wins_predicted: number
  home_wins_correct: number
  draws_predicted: number
  draws_correct: number
  away_wins_predicted: number
  away_wins_correct: number
  high_confidence_total: number
  high_confidence_correct: number
  medium_confidence_total: number
  medium_confidence_correct: number
  low_confidence_total: number
  low_confidence_correct: number
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
  recentAccuracy: number // Last 7 days
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
      
      // Charger les prédictions récentes
      const { data: predData, error: predError } = await supabase
        .from('predictions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (predError) throw predError

      setPredictions((predData as Prediction[]) || [])

      // Calculer les stats agrégées
      if (predData && predData.length > 0) {
        const total = predData.length
        const correct = predData.filter(p => p.status === 'correct').length
        const incorrect = predData.filter(p => p.status === 'incorrect').length
        const pending = predData.filter(p => p.status === 'pending').length
        const verified = correct + incorrect
        const accuracy = verified > 0 ? Math.round((correct / verified) * 100) : 0

        // Par résultat
        const homePred = predData.filter(p => p.prediction === '1')
        const drawPred = predData.filter(p => p.prediction === 'X')
        const awayPred = predData.filter(p => p.prediction === '2')

        // Par confiance
        const highConf = predData.filter(p => p.confidence >= 70)
        const medConf = predData.filter(p => p.confidence >= 50 && p.confidence < 70)
        const lowConf = predData.filter(p => p.confidence < 50)

        // Calculer précision 7 derniers jours
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
        // Si c'est une erreur de doublon, ignorer
        if (error.code === '23505') {
          console.log('Prediction already exists for this match today')
          return null
        }
        throw error
      }

      // Recharger les prédictions
      await loadPredictions()
      
      return data as Prediction
    } catch (err) {
      console.error('Error saving prediction:', err)
      throw err
    }
  }, [loadPredictions])

  // Sauvegarder plusieurs prédictions
  const savePredictions = useCallback(async (preds: Array<{
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
  }>) => {
    try {
      const { data, error } = await supabase
        .from('predictions')
        .insert(preds.map(p => ({
          ...p,
          league: p.league || 'Instant League',
          status: 'pending'
        })))
        .select()

      if (error) throw error

      await loadPredictions()
      
      return data as Prediction[]
    } catch (err) {
      console.error('Error saving predictions:', err)
      throw err
    }
  }, [loadPredictions])

  // Vérifier les prédictions (appel à la Edge Function)
  const verifyPredictions = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-predictions', {
        headers: {
          'x-cron-key': 'bet261_cron_2024'
        }
      })

      if (error) throw error

      // Recharger les données
      await loadPredictions()

      return data
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
    savePredictions,
    verifyPredictions,
    refresh: loadPredictions
  }
}
