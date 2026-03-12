import { useState, useEffect } from "react";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import { useLiveMatches } from "@/hooks/use-live-matches";
import { isPremium } from "@/lib/storage";
import { supabase } from "@/integrations/supabase/client";
import { analyzeMatch, type MatchInput, type MatchResult, type AIPrediction } from "@/lib/prediction-engine";
import { saveToHistory } from "@/lib/storage";
import ResultCard from "@/components/ResultCard";
import { toast } from "sonner";
import {
  RefreshCw, Loader2, Clock, Trophy, Lock, Zap, Wifi, WifiOff,
  Shield, Swords, Target, TrendingUp, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ScrapedMatch } from "@/lib/types";

function MatchCard({
  match,
  onPredict,
  predicting,
}: {
  match: ScrapedMatch;
  onPredict: (m: ScrapedMatch) => void;
  predicting: boolean;
}) {
  const hasPremium = isPremium();

  const statusColor =
    match.status === "live" ? "text-success" :
    match.status === "finished" ? "text-muted-foreground" :
    "text-ice";

  const statusLabel =
    match.status === "live" ? `🔴 LIVE ${match.minute ? `(${match.minute}')` : ""}` :
    match.status === "finished" ? "✅ Terminé" :
    `⏰ ${match.kickoff || "À venir"}`;

  return (
    <div className="bg-gradient-card rounded-xl border border-border overflow-hidden shadow-card">
      {/* Match header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className={`text-[10px] font-display tracking-wider ${statusColor}`}>
          {statusLabel}
        </span>
        {match.stats && (
          <div className="flex items-center gap-1">
            {match.stats.system && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-fire/30 text-fire">
                {match.stats.system === "attack" ? (
                  <><Swords size={10} className="mr-0.5" />ATK</>
                ) : match.stats.system === "defensive" ? (
                  <><Shield size={10} className="mr-0.5" />DEF</>
                ) : (
                  <><Target size={10} className="mr-0.5" />{match.stats.system}</>
                )}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Teams & Score */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-display font-bold text-foreground truncate">{match.home}</p>
          </div>
          {match.status !== "upcoming" && match.scoreHome != null ? (
            <div className="flex items-center gap-1 mx-3">
              <span className="text-lg font-display font-black text-foreground">{match.scoreHome}</span>
              <span className="text-xs text-muted-foreground">-</span>
              <span className="text-lg font-display font-black text-foreground">{match.scoreAway}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground font-display mx-3">VS</span>
          )}
          <div className="flex-1 text-right">
            <p className="text-sm font-display font-bold text-foreground truncate">{match.away}</p>
          </div>
        </div>
      </div>

      {/* Odds */}
      {match.oddHome > 0 && (
        <div className="grid grid-cols-3 gap-px bg-border/30 mx-3 mb-3 rounded-lg overflow-hidden">
          <div className="bg-muted/50 text-center py-1.5">
            <span className="text-[9px] text-muted-foreground block">DOM</span>
            <span className="text-xs font-display font-bold text-foreground">{match.oddHome}</span>
          </div>
          <div className="bg-muted/50 text-center py-1.5">
            <span className="text-[9px] text-muted-foreground block">NUL</span>
            <span className="text-xs font-display font-bold text-foreground">{match.oddDraw}</span>
          </div>
          <div className="bg-muted/50 text-center py-1.5">
            <span className="text-[9px] text-muted-foreground block">EXT</span>
            <span className="text-xs font-display font-bold text-foreground">{match.oddAway}</span>
          </div>
        </div>
      )}

      {/* Stats if available */}
      {match.stats && Object.keys(match.stats).length > 0 && (
        <div className="px-3 pb-2">
          <div className="flex flex-wrap gap-1">
            {match.stats.possession && (
              <Badge variant="secondary" className="text-[9px]">
                Poss: {match.stats.possession}
              </Badge>
            )}
            {match.stats.shots && (
              <Badge variant="secondary" className="text-[9px]">
                Tirs: {match.stats.shots}
              </Badge>
            )}
            {match.stats.corners && (
              <Badge variant="secondary" className="text-[9px]">
                Corners: {match.stats.corners}
              </Badge>
            )}
            {match.stats.cards && (
              <Badge variant="secondary" className="text-[9px]">
                Cartons: {match.stats.cards}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Predict button (Premium only) */}
      <div className="px-3 pb-3">
        {hasPremium ? (
          <Button
            size="sm"
            className="w-full bg-gradient-fire text-primary-foreground font-display text-xs tracking-wider"
            disabled={predicting || match.oddHome <= 0}
            onClick={() => onPredict(match)}
          >
            {predicting ? (
              <><Loader2 size={14} className="mr-1 animate-spin" /> ANALYSE...</>
            ) : (
              <><Zap size={14} className="mr-1" /> PRÉDIRE CE MATCH</>
            )}
          </Button>
        ) : (
          <div className="flex items-center justify-center gap-1.5 py-2 bg-gold/10 rounded-lg border border-gold/20">
            <Lock size={12} className="text-gold" />
            <span className="text-[10px] font-display text-gold tracking-wider">PREMIUM REQUIS</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LiveMatches() {
  const {
    matchesByLeague,
    loading,
    lastUpdate,
    error,
    fetchMatches,
    startAutoRefresh,
    stopAutoRefresh,
  } = useLiveMatches();

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [predictingId, setPredictingId] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Record<string, MatchResult>>({});

  useEffect(() => {
    fetchMatches();
  }, []);

  const toggleAutoRefresh = () => {
    if (autoRefresh) {
      stopAutoRefresh();
      setAutoRefresh(false);
      toast.info("Rafraîchissement auto désactivé");
    } else {
      startAutoRefresh();
      setAutoRefresh(true);
      toast.success("Rafraîchissement auto activé (2 min)");
    }
  };

  const handlePredict = async (match: ScrapedMatch) => {
    const matchKey = `${match.home}-${match.away}`;
    setPredictingId(matchKey);

    try {
      const matchInput: MatchInput = {
        home: match.home,
        away: match.away,
        league: match.league,
        oddHome: match.oddHome,
        oddDraw: match.oddDraw,
        oddAway: match.oddAway,
      };

      // Call AI
      const { data, error: fnError } = await supabase.functions.invoke("analyze-match", {
        body: { matches: [matchInput] },
      });

      let aiPrediction: AIPrediction | undefined;

      if (!fnError && data?.predictions?.[0]) {
        aiPrediction = data.predictions[0];
      }

      const result = analyzeMatch(matchInput, aiPrediction);
      await saveToHistory(result);
      setPredictions(prev => ({ ...prev, [matchKey]: result }));
      toast.success("Prédiction générée 🔥");
    } catch (err) {
      toast.error("Erreur lors de la prédiction");
    } finally {
      setPredictingId(null);
    }
  };

  const leagues = Object.keys(matchesByLeague);
  const totalMatches = Object.values(matchesByLeague).reduce((s, m) => s + m.length, 0);

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-4">
        <AppHeader />

        {/* Controls */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-sm text-foreground tracking-wider">
              Matchs en Direct
            </h2>
            {lastUpdate && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                <Clock size={10} />
                Maj: {new Date(lastUpdate).toLocaleTimeString("fr-FR")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={autoRefresh ? "default" : "outline"}
              onClick={toggleAutoRefresh}
              className={`text-xs ${autoRefresh ? "bg-gradient-fire text-primary-foreground" : ""}`}
            >
              {autoRefresh ? <Wifi size={14} /> : <WifiOff size={14} />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchMatches()}
              disabled={loading}
              className="text-xs"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        {totalMatches > 0 && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Badge variant="secondary" className="text-[10px] font-display">
              <Trophy size={10} className="mr-1" />
              {leagues.length} Ligues
            </Badge>
            <Badge variant="secondary" className="text-[10px] font-display">
              ⚽ {totalMatches} Matchs
            </Badge>
            {autoRefresh && (
              <Badge className="text-[10px] font-display bg-success/20 text-success border-success/30">
                🔄 Auto 2min
              </Badge>
            )}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-destructive" />
              <span className="text-xs text-destructive">{error}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchMatches()}
              className="mt-2 text-xs"
            >
              Réessayer
            </Button>
          </div>
        )}

        {/* Loading state */}
        {loading && totalMatches === 0 && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 size={32} className="text-fire animate-spin" />
            <p className="text-sm text-muted-foreground font-display tracking-wider">
              Récupération des matchs...
            </p>
            <p className="text-[10px] text-muted-foreground">
              Scraping bet261.mg/virtual via Firecrawl
            </p>
          </div>
        )}

        {/* Matches by league */}
        {leagues.length > 0 && (
          <div className="space-y-6">
            {leagues.map(league => (
              <div key={league}>
                <div className="flex items-center gap-2 mb-3">
                  <Trophy size={14} className="text-gold" />
                  <h3 className="font-display text-xs text-gold tracking-widest uppercase">{league}</h3>
                  <Badge variant="outline" className="text-[9px] border-gold/30 text-gold">
                    {matchesByLeague[league].length}
                  </Badge>
                </div>
                <div className="space-y-3">
                  {matchesByLeague[league].map((match, idx) => {
                    const matchKey = `${match.home}-${match.away}`;
                    const prediction = predictions[matchKey];
                    return (
                      <div key={`${league}-${idx}`}>
                        <MatchCard
                          match={match}
                          onPredict={handlePredict}
                          predicting={predictingId === matchKey}
                        />
                        {prediction && (
                          <div className="mt-2">
                            <ResultCard result={prediction} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && totalMatches === 0 && !error && (
          <div className="text-center py-12">
            <Trophy size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground font-display">Aucun match trouvé</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Cliquez sur Rafraîchir pour récupérer les matchs
            </p>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
