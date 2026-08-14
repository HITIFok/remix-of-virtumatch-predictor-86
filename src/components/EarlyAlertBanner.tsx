import { useState } from 'react';
import { useEarlyAlerts, type EarlyAlert, useNotificationPermission } from '@/hooks/use-early-alerts';
import { isSoundEnabled, toggleSound } from '@/lib/notifications';
import { Zap, X, ChevronDown, ChevronUp, Clock, Trophy, Bell, BellOff, Volume2, VolumeX } from 'lucide-react';

// ─── Single Alert Row ─────────────────────────────────────────────────────

function AlertRow({ alert }: { alert: EarlyAlert }) {
  const earlyText = alert.howEarlySeconds >= 60
    ? `${Math.floor(alert.howEarlySeconds / 60)}m ${alert.howEarlySeconds % 60}s`
    : `${alert.howEarlySeconds}s`;

  const outcomeEmoji = alert.outcome === '1' ? '🏠' : alert.outcome === '2' ? '✈️' : '🤝';

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-black/20 hover:bg-black/30 transition-colors">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-sm flex-shrink-0">{outcomeEmoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-white/90 truncate">
            {alert.homeTeam} <span className="text-fire font-bold">{alert.scoreHome}</span>
            <span className="text-white/40 mx-1">-</span>
            <span className="text-fire font-bold">{alert.scoreAway}</span> {alert.awayTeam}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-white/50">{alert.leagueName}</span>
            <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
              <Zap size={8} />
              {earlyText} avant
            </span>
          </div>
        </div>
      </div>
      <div className="flex-shrink-0">
        <span className="text-lg font-display font-black text-fire">
          {alert.scoreHome}-{alert.scoreAway}
        </span>
      </div>
    </div>
  );
}

// ─── Main Banner Component ────────────────────────────────────────────────

export default function EarlyAlertBanner() {
  const { alerts, alertsByLeague, hasAlerts, newAlertCount, refetch } = useEarlyAlerts();
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const { permission, canAsk, requestPermission, supported } = useNotificationPermission();

  // Don't show if no alerts or user dismissed
  if (!hasAlerts || dismissed) return null;

  const uniqueLeagues = Object.keys(alertsByLeague);
  const totalAlerts = alerts.length;

  const handleToggleSound = () => {
    const next = toggleSound();
    setSoundOn(next);
  };

  const handleEnableNotifications = async () => {
    if (!supported) return;
    await requestPermission();
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] animate-slide-down">
      {/* Glow effect behind banner */}
      <div className="absolute inset-0 bg-gradient-to-r from-fire/20 via-gold/20 to-fire/20 blur-xl opacity-60" />

      <div className="relative glass-premium border-b border-fire/30">
        {/* Header — always visible */}
        <div className="flex items-center justify-between px-3 py-2 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Animated pulse indicator */}
            <div className="relative flex-shrink-0">
              <Zap size={16} className="text-fire animate-pulse" />
              <div className="absolute inset-0 bg-fire/40 rounded-full animate-ping opacity-30" />
            </div>

            <div className="min-w-0">
              <p className="text-xs font-display font-bold text-fire tracking-wider truncate">
                RESULTATS DETECTES EN AVANCE
              </p>
              <p className="text-[10px] text-white/50">
                {totalAlerts} resultat{totalAlerts > 1 ? 's' : ''} · {uniqueLeagues.length} ligue{uniqueLeagues.length > 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Sound toggle */}
            <button
              onClick={handleToggleSound}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title={soundOn ? 'Couper le son' : 'Activer le son'}
            >
              {soundOn ? (
                <Volume2 size={12} className="text-emerald-400" />
              ) : (
                <VolumeX size={12} className="text-white/40" />
              )}
            </button>

            {/* Notification bell */}
            {permission === 'granted' ? (
              <div className="p-1.5" title="Notifications actives">
                <Bell size={12} className="text-emerald-400" />
              </div>
            ) : canAsk || permission === 'default' ? (
              <button
                onClick={handleEnableNotifications}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Activer les notifications push"
              >
                <BellOff size={12} className="text-gold" />
              </button>
            ) : null}

            {/* Refresh button */}
            <button
              onClick={refetch}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title="Rafraichir"
            >
              <Trophy size={12} className="text-white/50" />
            </button>

            {/* Expand/collapse */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            >
              {expanded ? (
                <ChevronUp size={14} className="text-white/60" />
              ) : (
                <ChevronDown size={14} className="text-white/60" />
              )}
            </button>

            {/* Dismiss */}
            <button
              onClick={() => setDismissed(true)}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title="Masquer"
            >
              <X size={14} className="text-white/40" />
            </button>
          </div>
        </div>

        {/* Alert list — expandable */}
        {expanded && (
          <div className="px-3 pb-3 space-y-1.5 max-h-[40vh] overflow-y-auto scrollbar-thin">
            {/* Group by league */}
            {Object.entries(alertsByLeague).map(([key, leagueAlerts]) => (
              <div key={key}>
                <div className="flex items-center gap-1.5 px-1 mb-1">
                  <Clock size={10} className="text-gold/70" />
                  <span className="text-[10px] font-display text-gold/70 tracking-wider uppercase">
                    {leagueAlerts[0].leagueName} — Round {leagueAlerts[0].roundNumber}
                  </span>
                </div>
                <div className="space-y-1">
                  {leagueAlerts.map(alert => (
                    <AlertRow key={alert.id} alert={alert} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom shadow */}
      <div className="h-2 bg-gradient-to-b from-black/30 to-transparent" />
    </div>
  );
}
