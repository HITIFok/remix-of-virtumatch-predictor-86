// Hook pour gérer les prédictions et leur suivi de précision
import { useState, useEffect, useCallback } from 'react'
import { config } from '@/config/env'
import { getDeviceId } from '@/lib/device'
export { getDeviceId }

// camelCase — matches api/predictions.js mapToCamelCase() output
export interface Prediction {
  id: number
  matchId: number | null
  homeTeam: string
  awayTeam: string
  league: string
  leagueId: string | null
  oddHome: number
  oddDraw: number
  oddAway: number
  probHome: number
  probDraw: number
  probAway: number
  prediction: '1' | 'X' | '2'
  confidence: number
  predictedHomeScore: number | null
  predictedAwayScore: number | null
  predictedScore: string | null
  actualHomeScore: number | null
  actualAwayScore: number | null
  actualOutcome: '1' | 'X' | '2' | null
  actualScore: string | null
  status: 'pending' | 'correct' | 'incorrect'
  verifiedAt: string | null
  createdAt: string
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

  // Charger les prédictions (vérification auto en parallèle, non bloquante)
  const loadPredictions = useCallback(async (skipAutoVerify = false) => {
    try {
      setLoading(true)

      // Lancer la vérification en parallèle (sans bloquer le chargement)
      const verifyPromise = skipAutoVerify ? null : autoVerifyPredictions()

      const deviceId = getDeviceId()
      console.log('[loadPredictions] deviceId:', deviceId);
      const url = `${config.api.predictions}?device_id=${encodeURIComponent(deviceId)}`;
      const res = await fetch(url);
      console.log('[loadPredictions] status:', res.status, res.statusText);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('[loadPredictions] API error body:', errText);
        setPredictions([]);
        setStats(null);
        return;
      }
      const json = await res.json();
      console.log('[loadPredictions] response keys:', Object.keys(json), 'predictions count:', json.predictions?.length);
      const { predictions } = json;
      const predData = (Array.isArray(predictions) ? predictions : []) as Prediction[];

      setPredictions(predData)

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
        const recentPreds = predData.filter(p => new Date(p.createdAt) >= weekAgo)
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

      // Si vérification en cours, attendre et rafraîchir une fois terminée
      if (verifyPromise) {
        verifyPromise.then(() => loadPredictions(true)).catch(() => {})
      }
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

      const res = await fetch(config.api.predictions, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(insertData),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 409 || errBody?.code === '23505') {
          return null;
        }
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }

      const savedData = await res.json();

      await loadPredictions(true) // Skip auto-verify after save (just saved)

      return (savedData?.row || savedData) as Prediction
    } catch (err: any) {
      console.error('Error saving prediction:', err)
      if (err?.code === '23505') {
        return null
      }
      throw err
    }
  }, [loadPredictions])

  // Supprimer une prédiction par ID
  const deletePrediction = useCallback(async (id: number) => {
    try {
      const deviceId = getDeviceId();
      const res = await fetch(config.api.predictions, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, prediction_id: id }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

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
      const deviceId = getDeviceId();
      const res = await fetch(config.api.predictions, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, status: 'pending' }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

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
