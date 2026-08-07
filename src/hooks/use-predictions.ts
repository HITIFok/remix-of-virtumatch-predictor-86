// Hook pour gérer les prédictions et leur suivi de précision
import { useState, useEffect, useCallback } from 'react'
import { sql } from '@/integrations/neon/client'
import { config } from '@/config/env'

// Device ID for tracking predictions per device
export function getDeviceId(): string {
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
    home: { predicted: number; correct: number; accuracy: number }
    draw: { predicted: number; correct: number; accuracy: number }
    away: { predicted: number; correct: number; accuracy: number }
  }
  byConfidence: {
    high: { total: number; correct: number; accuracy: number }
    medium: { total: number; correct: number; accuracy: number }
    low: { total: number; correct: number; accuracy: number }
  }
  recentAccuracy: number
  recentCorrect: number
  recentTotal: number
}

export function usePredictions() {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [stats, setStats] = useState<AggregatedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Vérifier automatiquement les prédictions en attente (device-scoped)
  const autoVerifyPredictions = useCallback(async () => {
    try {
      const deviceId = getDeviceId()

      const res = await fetch(`${config.api.verifyPredictionsUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });

      if (!res.ok) {
        console.warn('[autoVerify] API error:', res.status);
        return null;
      }

      const data = await res.json();

      if (data) {
        console.log('[autoVerify]', data.verified || 0, 'prediction(s) vérifiée(s)');
        return data;
      }
    } catch (err) {
      console.warn('[autoVerify] skipped:', err);
    }
    return null;
  }, [])

  // Charger les prédictions (avec vérification automatique)
  const loadPredictions = useCallback(async (skipAutoVerify = false) => {
    try {
      setLoading(true)

      // D'abord vérifier automatiquement les prédictions en attente
      if (!skipAutoVerify) {
        await autoVerifyPredictions()
      }

      const deviceId = getDeviceId()
      const predData = await sql`
        SELECT * FROM predictions 
        WHERE device_id = ${deviceId} 
        ORDER BY created_at DESC 
        LIMIT 200
      `;

      setPredictions((predData as Prediction[]) || [])

      if (predData && predData.length > 0) {
        const total = predData.length
        const correct = predData.filter(p => p.status === 'correct').length
        const incorrect = predData.filter(p => p.status === 'incorrect').length
        const pending = predData.filter(p => p.status === 'pending').length
        const verified = correct + incorrect
        const accuracy = verified > 0 ? Math.round((correct / verified) * 100) : 0

        // Par type de prédiction
        const homePred = predData.filter(p => p.prediction === '1')
        const homeCorrect = homePred.filter(p => p.status === 'correct').length
        const homeVerified = homePred.filter(p => p.status !== 'pending').length
        
        const drawPred = predData.filter(p => p.prediction === 'X')
        const drawCorrect = drawPred.filter(p => p.status === 'correct').length
        const drawVerified = drawPred.filter(p => p.status !== 'pending').length
        
        const awayPred = predData.filter(p => p.prediction === '2')
        const awayCorrect = awayPred.filter(p => p.status === 'correct').length
        const awayVerified = awayPred.filter(p => p.status !== 'pending').length

        // Par niveau de confiance
        const highConf = predData.filter(p => p.confidence >= 70)
        const highCorrect = highConf.filter(p => p.status === 'correct').length
        const highVerified = highConf.filter(p => p.status !== 'pending').length
        
        const medConf = predData.filter(p => p.confidence >= 50 && p.confidence < 70)
        const medCorrect = medConf.filter(p => p.status === 'correct').length
        const medVerified = medConf.filter(p => p.status !== 'pending').length
        
        const lowConf = predData.filter(p => p.confidence < 50)
        const lowCorrect = lowConf.filter(p => p.status === 'correct').length
        const lowVerified = lowConf.filter(p => p.status !== 'pending').length

        // Précision récente (7 derniers jours)
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
              correct: homeCorrect,
              accuracy: homeVerified > 0 ? Math.round((homeCorrect / homeVerified) * 100) : 0
            },
            draw: { 
              predicted: drawPred.length, 
              correct: drawCorrect,
              accuracy: drawVerified > 0 ? Math.round((drawCorrect / drawVerified) * 100) : 0
            },
            away: { 
              predicted: awayPred.length, 
              correct: awayCorrect,
              accuracy: awayVerified > 0 ? Math.round((awayCorrect / awayVerified) * 100) : 0
            },
          },
          byConfidence: {
            high: { 
              total: highConf.length, 
              correct: highCorrect,
              accuracy: highVerified > 0 ? Math.round((highCorrect / highVerified) * 100) : 0
            },
            medium: { 
              total: medConf.length, 
              correct: medCorrect,
              accuracy: medVerified > 0 ? Math.round((medCorrect / medVerified) * 100) : 0
            },
            low: { 
              total: lowConf.length, 
              correct: lowCorrect,
              accuracy: lowVerified > 0 ? Math.round((lowCorrect / lowVerified) * 100) : 0
            },
          },
          recentAccuracy,
          recentCorrect,
          recentTotal: recentVerified.length
        })
      } else {
        setStats(null)
      }

      setError(null)
    } catch (err) {
  console.error('Error loading predictions:', err)
  const msg = err instanceof Error ? err.message : 'Erreur de chargement'
  setError(msg)
  console.error('PREDICTIONS ERROR DETAIL:', JSON.stringify(err))
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
    league_id?: string
    round?: number
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

      const insertData = {
        ...pred,
        league: pred.league || 'Instant League',
        status: 'pending',
        device_id: deviceId,
        home: pred.home_team,
        away: pred.away_team,
        score_home: pred.predicted_home_score,
        score_away: pred.predicted_away_score,
        exact_score: pred.predicted_score,
        winner_1x2: pred.winner_1x2 || (pred.prediction === '1' ? `1 — ${pred.home_team}` : pred.prediction === '2' ? `2 — ${pred.away_team}` : 'X (Nul)'),
        // Round-aware: store round + league_id for precise verification
        round: pred.round || null,
        league_id: pred.league_id || null,
      }

      const data = await sql`
        INSERT INTO predictions (
          match_id, home_team, away_team, league, league_id, round,
          odd_home, odd_draw, odd_away,
          prob_home, prob_draw, prob_away,
          prediction, confidence,
          predicted_home_score, predicted_away_score, predicted_score,
          gg_result, total_goals, parity,
          over_under_15, over_under_25, over_under_35,
          prob_gg, prob_gn, btts_prob, over25_prob,
          first_half_goal_prob, expected_goals,
          winner_1x2,
          device_id, status, home, away,
          score_home, score_away, exact_score
        ) VALUES (
          ${insertData.match_id || null}, ${insertData.home_team}, ${insertData.away_team}, ${insertData.league}, ${insertData.league_id || null}, ${insertData.round || null},
          ${insertData.odd_home}, ${insertData.odd_draw}, ${insertData.odd_away},
          ${insertData.prob_home}, ${insertData.prob_draw}, ${insertData.prob_away},
          ${insertData.prediction}, ${insertData.confidence},
          ${insertData.predicted_home_score || null}, ${insertData.predicted_away_score || null}, ${insertData.predicted_score || null},
          ${insertData.gg_result || ''}, ${insertData.total_goals || 0}, ${insertData.parity || ''},
          ${insertData.over_under_15 || ''}, ${insertData.over_under_25 || ''}, ${insertData.over_under_35 || ''},
          ${insertData.prob_gg || 0}, ${insertData.prob_gn || 0}, ${insertData.btts_prob || 0}, ${insertData.over25_prob || 0},
          ${insertData.first_half_goal_prob || 0}, ${insertData.expected_goals || 0},
          ${insertData.winner_1x2},
          ${insertData.device_id}, ${insertData.status}, ${insertData.home}, ${insertData.away},
          ${insertData.score_home || null}, ${insertData.score_away || null}, ${insertData.exact_score || ''}
        )
        RETURNING *
      `

      if (!data || data.length === 0) {
        throw new Error('No data returned from insert');
      }

      await loadPredictions(true) // Skip auto-verify after save (just saved)

      return data[0] as Prediction
    } catch (err: any) {
      console.error('Error saving prediction:', err)
      if (err?.code === '23505') {
        return null
      }
      throw err
    }
  }, [loadPredictions])

  // Supprimer une prédiction par ID
  const deletePrediction = useCallback(async (id: string) => {
    try {
      await sql`DELETE FROM predictions WHERE id = ${id}`

      await loadPredictions(true)
      return true
    } catch (err) {
      console.error('Error deleting prediction:', err)
      throw err
    }
  }, [loadPredictions])

  // Supprimer toutes les prédictions "en attente" en une seule requête
  const deletePendingPredictions = useCallback(async () => {
    try {
      await sql`DELETE FROM predictions WHERE status = 'pending'`

      await loadPredictions(true)
      return true
    } catch (err) {
      console.error('Error deleting pending predictions:', err)
      throw err
    }
  }, [loadPredictions])

  // Vérifier manuellement les prédictions via API Route (optionnel)
  const verifyPredictions = useCallback(async () => {
    try {
      const result = await autoVerifyPredictions()
      await loadPredictions(true)
      
      return {
        success: true,
        verified: result?.verified || 0,
        correct: result?.correct || 0,
        incorrect: result?.incorrect || 0,
        stillPending: result?.stillPending || 0,
        totalResults: result?.totalResults || 0
      }
    } catch (err) {
      console.error('Error verifying predictions:', err)
      throw err
    }
  }, [autoVerifyPredictions, loadPredictions])

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
    deletePrediction,
    deletePendingPredictions,
    verifyPredictions,
    refresh: () => loadPredictions(false)
  }
}
