import { Lock, TrendingUp, Target, Brain, ShieldAlert, AlertTriangle, CheckCircle, BarChart3, Clock, Shield, Swords } from "lucide-react";
import type { MatchResult } from "@/lib/prediction-engine";
import { isPremium } from "@/lib/storage";

interface ResultCardProps {
  result: MatchResult;
}

function PremiumLock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-gold text-xs">
      <Lock size={12} />
      <span className="font-display tracking-wider">{label}</span>
    </div>
  );
}

function StatRow({ label, value, premium = false }: { label: string; value: string | number; premium?: boolean }) {
  const hasPremium = isPremium();
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      {premium && !hasPremium ? (
        <PremiumLock label="Premium" />
      ) : (
        <span className="text-sm font-semibold text-foreground">{value}</span>
      )}
    </div>
  );
}

function DangerBadge({ level }: { level: string }) {
  if (level === "trap") {
    return (
      <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
        <ShieldAlert size={14} className="text-destructive" />
        <span className="text-xs font-display text-destructive tracking-wider">⚠️ PIÈGE DÉTECTÉ — ANTI-TRAP ACTIVÉ</span>
      </div>
    );
  }
  if (level === "moderate") {
    return (
      <div className="flex items-center gap-2 bg-gold/10 border border-gold/30 rounded-lg px-3 py-2">
        <AlertTriangle size={14} className="text-gold" />
        <span className="text-xs font-display text-gold tracking-wider">⚡ MATCH SERRÉ — RISQUE MODÉRÉ</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 bg-success/10 border border-success/30 rounded-lg px-3 py-2">
      <CheckCircle size={14} className="text-success" />
      <span className="text-xs font-display text-success tracking-wider">✅ MATCH SÛR — FAVORI CONFIRMÉ</span>
    </div>
  );
}

export default function ResultCard({ result }: ResultCardProps) {
  const hasPremium = isPremium();

  return (
    <div className="bg-gradient-card rounded-xl shadow-card border border-border overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-fire p-4">
        <div className="flex justify-between items-center">
          <span className="font-display text-sm font-bold text-primary-foreground tracking-wide">{result.home}</span>
          <span className="text-xs text-primary-foreground/70 font-display">VS</span>
          <span className="font-display text-sm font-bold text-primary-foreground tracking-wide">{result.away}</span>
        </div>
        {result.league && (
          <p className="text-[10px] text-primary-foreground/60 text-center mt-1 font-display tracking-wider">
            {result.league}
          </p>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Danger level badge */}
        <DangerBadge level={result.dangerLevel} />

        {/* AI confidence */}
        {result.aiConfidence > 0 && (
          <div className="flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-lg px-3 py-2">
            <Brain size={14} className="text-accent" />
            <span className="text-xs text-muted-foreground">
              IA Confiance : <span className="font-display font-bold text-foreground">{(result.aiConfidence * 100).toFixed(0)}%</span>
            </span>
          </div>
        )}

        {/* Tendency */}
        {result.tendency && (
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
            <TrendingUp size={14} className="text-fire" />
            <span className="text-xs text-muted-foreground">
              Tendance : <span className="font-semibold text-foreground">{result.tendency}</span>
            </span>
          </div>
        )}

        {/* System & Possession */}
        {(result.systemHome || result.systemAway) && (
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/50 rounded-lg px-3 py-2 border border-border/50">
              <span className="text-[10px] text-muted-foreground block mb-1">Système {result.home}</span>
              <div className="flex items-center gap-1">
                {result.systemHome === "offensif" ? <Swords size={12} className="text-fire" /> : <Shield size={12} className="text-ice" />}
                <span className="text-xs font-display font-bold text-foreground capitalize">{result.systemHome}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Poss: {result.possessionHome}%</span>
            </div>
            <div className="bg-muted/50 rounded-lg px-3 py-2 border border-border/50">
              <span className="text-[10px] text-muted-foreground block mb-1">Système {result.away}</span>
              <div className="flex items-center gap-1">
                {result.systemAway === "offensif" ? <Swords size={12} className="text-fire" /> : <Shield size={12} className="text-ice" />}
                <span className="text-xs font-display font-bold text-foreground capitalize">{result.systemAway}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Poss: {result.possessionAway}%</span>
            </div>
          </div>
        )}

        {/* Probabilities bar */}
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">
            <span>Dom {(result.probHome * 100).toFixed(1)}%</span>
            <span>Nul {(result.probDraw * 100).toFixed(1)}%</span>
            <span>Ext {(result.probAway * 100).toFixed(1)}%</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-muted">
            <div className="bg-gradient-fire transition-all" style={{ width: `${result.probHome * 100}%` }} />
            <div className="bg-muted-foreground/40 transition-all" style={{ width: `${result.probDraw * 100}%` }} />
            <div className="bg-gradient-ice transition-all" style={{ width: `${result.probAway * 100}%` }} />
          </div>
        </div>

        {/* Free results */}
        <div className="space-y-0">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp size={14} className="text-fire" />
            <span className="text-xs font-display text-muted-foreground uppercase tracking-wider">Résultats</span>
          </div>
          <StatRow label="🏆 Gagnant 1X2" value={result.winner1X2} />
          <StatRow label="⏱ But 1ère mi-temps" value={result.firstHalfGoal ? "Oui ✅" : `Prob: ${(result.firstHalfGoalProb * 100).toFixed(1)}%`} />
          <StatRow label="⚽ BTTS (Les 2 marquent)" value={result.bttsProb > 0 ? `${(result.bttsProb * 100).toFixed(0)}%` : "-"} />
          <StatRow label="📊 Over 2.5 Prob" value={result.over25Prob > 0 ? `${(result.over25Prob * 100).toFixed(0)}%` : "-"} />
        </div>

        {/* Premium results */}
        <div className="space-y-0">
          <div className="flex items-center gap-1.5 mb-2">
            <Target size={14} className="text-gold" />
            <span className="text-xs font-display text-gold uppercase tracking-wider">Premium</span>
          </div>
          <StatRow label="⚽ Score Exact Garanti" value={result.exactScore} premium />
          <StatRow label="🕐 Score Mi-Temps" value={result.firstHalfScore || "-"} premium />
          <StatRow label="🎯 GG / GN" value={result.ggResult} premium />
          <StatRow label="📊 Total de buts" value={`${result.totalGoals} (${result.parity})`} premium />
          <StatRow label="📈 Over/Under 1.5" value={result.overUnder15} premium />
          <StatRow label="📈 Over/Under 2.5" value={result.overUnder25} premium />
          <StatRow label="📈 Over/Under 3.5" value={result.overUnder35} premium />
        </div>

        {/* Top 3 scores */}
        {result.topScores && result.topScores.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <BarChart3 size={14} className="text-ice" />
              <span className="text-xs font-display text-ice uppercase tracking-wider">Top 3 Scores Probables</span>
            </div>
            {hasPremium ? (
              <div className="grid grid-cols-3 gap-2">
                {result.topScores.map((ts, i) => (
                  <div key={i} className="bg-muted/50 rounded-lg p-2 text-center border border-border/50">
                    <span className="font-display text-sm font-bold text-foreground">{ts.score}</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{(ts.probability * 100).toFixed(0)}%</p>
                  </div>
                ))}
              </div>
            ) : (
              <PremiumLock label="Débloquer les scores probables" />
            )}
          </div>
        )}

        {/* AI Reasoning */}
        {result.aiReasoning && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Brain size={14} className="text-accent" />
              <span className="text-xs font-display text-accent uppercase tracking-wider">Analyse IA Détaillée</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{result.aiReasoning}</p>
          </div>
        )}
      </div>
    </div>
  );
}
