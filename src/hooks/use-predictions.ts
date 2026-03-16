// Hook pour gérer les prédictions et leur suivi de précision
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'

// Device ID for tracking predictions per device
function getDeviceId(): string {
  let id = localStorage.getItem("virtuxxs_device_id");
  if (!id) {
    id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("virtuxxs_device_id", id);
  }
  return id;
}

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
    // Champs supplémentaires pour éviter N/A
    gg_result?: string
    total_goals?: number
    parity?: string
    over_under_15?: string
    over_under_25?: string
    over_under_35?: string
    prob_gg?: number
    prob_gn?: number
    btts_prob?: number
    over25_prob?: number
    first_half_goal_prob?: number
    expected_goals?: number
    winner_1x2?: string
  }) => {
    try {
      const deviceId = getDeviceId()
      const { data, error } = await supabase
        .from('predictions')
        .insert({
          ...pred,
          league: pred.league || 'Instant League',
          status: 'pending',
          device_id: deviceId,
          // Ajouter les alias pour compatibilité avec storage.ts
          home: pred.home_team,
          away: pred.away_team,
          score_home: pred.predicted_home_score,
          score_away: pred.predicted_away_score,
          exact_score: pred.predicted_score,
          // Calculer le winner_1x2 si non fourni
          winner_1x2: pred.winner_1x2 || (pred.prediction === '1' ? `1 — ${pred.home_team}` : pred.prediction === '2' ? `2 — ${pred.away_team}` : 'X (Nul)')
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

  // Vérifier les prédictions - appel direct via fetch avec timeout
  const verifyPredictions = useCallback(async () => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
      
      console.log('🔍 Calling verify-predictions...')
      
      // Appel direct avec fetch et timeout de 30 secondes
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      
      const response = await fetch(`${supabaseUrl}/functions/v1/verify-predictions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`
        },
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      console.log('📡 Response status:', response.status)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ Error response:', errorText)
        throw new Error(`Erreur ${response.status}: ${errorText}`)
      }
      
      const data = await response.json()
      console.log('✅ Verification result:', data)
      
      // Recharger les données
      await loadPredictions()

      return data
    } catch (err) {
      console.error('❌ Error verifying predictions:', err)
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
