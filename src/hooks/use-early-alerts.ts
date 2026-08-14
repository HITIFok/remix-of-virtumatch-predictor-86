import { useState, useEffect, useCallback, useRef } from 'react';
import { config } from '@/config/env';
import {
  notifyExploit,
  supportsNotifications,
  getNotificationPermission,
  requestNotificationPermission,
  hasAlreadyAskedPermission,
} from '@/lib/notifications';

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
  const prevAlertsRef = useRef<Set<string>>(new Set());
  const notifiedRef = useRef<Set<string>>(new Set());

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
        const newAlerts = data.alerts;

        // ── Push Notification Logic ──
        // Detect NEW alerts that weren't in previous fetch
        const currentIds = new Set(newAlerts.map(a => a.id));
        const newIds: string[] = [];

        for (const id of currentIds) {
          if (!prevAlertsRef.current.has(id) && !notifiedRef.current.has(id)) {
            newIds.push(id);
            notifiedRef.current.add(id);
          }
        }

        // Fire notifications for new alerts (batch by league-round)
        if (newIds.length > 0) {
          const newAlertList = newAlerts.filter(a => newIds.includes(a.id));
          const leagueRoundGroups = new Map<string, EarlyAlert[]>();

          for (const alert of newAlertList) {
            const key = `${alert.leagueId}-${alert.roundNumber}`;
            if (!leagueRoundGroups.has(key)) leagueRoundGroups.set(key, []);
            leagueRoundGroups.get(key)!.push(alert);
          }

          for (const [, group] of leagueRoundGroups) {
            const first = group[0];
            const maxEarly = Math.max(...group.map(a => a.howEarlySeconds));

            notifyExploit(
              first.homeTeam,
              first.awayTeam,
              first.scoreHome,
              first.scoreAway,
              first.leagueName,
              maxEarly,
              group.length,
            );
          }
        }

        prevAlertsRef.current = currentIds;
        setAlerts(newAlerts);
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
  const newAlertCount = Math.max(0, activeAlerts.length - prevAlertsRef.current.size);

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

// ─── Notification Permission Hook ──────────────────────────────────────────

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window === 'undefined') return 'denied';
    return getNotificationPermission();
  });

  const canAsk = supportsNotifications() && !hasAlreadyAskedPermission();

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    const result = await requestNotificationPermission();
    setPermission(result);
    return result;
  }, []);

  return {
    permission,
    canAsk,
    requestPermission,
    supported: supportsNotifications(),
  };
}
