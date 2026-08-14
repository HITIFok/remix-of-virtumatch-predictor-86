import { useState, useEffect, useCallback, useRef } from 'react';
import { config } from '@/config/env';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EarlyAlert {
  id: string;
  leagueId: string;
  leagueName: string;
  roundNumber: number;
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  outcome: string;
  expectedStart: string | null;
  detectedAt: string;
  howEarlySeconds: number;
  dismissed: boolean;
}

interface EarlyAlertsResponse {
  success: boolean;
  alerts: EarlyAlert[];
  count: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 20_000; // 20 seconds

export function useEarlyAlerts() {
  const [alerts, setAlerts] = useState<EarlyAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastPoll, setLastPoll] = useState<string | null>(null);
  const prevCountRef = useRef(0);

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(config.api.earlyAlertsUrl);

      if (!res.ok) {
        console.warn('[early-alerts] API error:', res.status);
        return;
      }

      const data: EarlyAlertsResponse = await res.json();
      if (data?.success) {
        setAlerts(data.alerts);
        setLastPoll(new Date().toISOString());
      }
    } catch (err) {
      // Silent — non-critical
      console.warn('[early-alerts] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling every 20s
  useEffect(() => {
    fetchAlerts();

    const interval = setInterval(fetchAlerts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Compute derived state
  const activeAlerts = alerts.filter(a => !a.dismissed && a.howEarlySeconds > 0);
  const hasAlerts = activeAlerts.length > 0;
  const newAlertCount = Math.max(0, activeAlerts.length - prevCountRef.current);

  // Update previous count ref when alerts change
  useEffect(() => {
    prevCountRef.current = activeAlerts.length;
  }, [activeAlerts.length]);

  // Group by league
  const alertsByLeague = activeAlerts.reduce<Record<string, EarlyAlert[]>>((acc, a) => {
    const key = `${a.leagueId}-${a.roundNumber}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  return {
    alerts: activeAlerts,
    alertsByLeague,
    hasAlerts,
    newAlertCount,
    totalDetected: alerts.length,
    loading,
    lastPoll,
    refetch: fetchAlerts,
  };
}
