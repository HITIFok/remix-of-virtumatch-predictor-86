import { useState, useEffect } from "react";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import { useLiveMatches } from "@/hooks/use-live-matches";
import { usePredictions } from "@/hooks/use-predictions";
import { isPremium } from "@/lib/storage";
import { supabase } from "@/integrations/supabase/client";
import { analyzeMatch, buildTeamStatsMap, prepareHistoricalResults, type MatchInput, type MatchResult, type AIPrediction } from "@/lib/prediction-engine";
import { saveToHistory } from "@/lib/storage";
import ResultCard from "@/components/ResultCard";
import { RankingTable, ResultsList } from "@/components/LeagueData";
import { toast } from "sonner";
import {
  RefreshCw, Loader2, Clock, Trophy, Lock, Zap, Wifi, WifiOff,
  Shield, Swords, Target, AlertTriangle, BarChart3, ListOrdered,
  CheckCircle, XCircle, TrendingUp, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
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
    match.status === "betting" ? "text-fire" :
    "text-ice";

  // Format kickoff time nicely
  const formatKickoff = (kickoff: string) => {
    if (!kickoff) return "À venir";
    try {
      const date = new Date(kickoff);
      if (isNaN(date.getTime())) return kickoff;
      return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return kickoff;
    }
  };

  const statusLabel =
    match.status === "live" ? `🔴 LIVE ${match.minute ? `(${match.minute}')` : ""}` :
    match.status === "finished" ? "✅ Terminé" :
    match.status === "betting" ? "🟢 Paris ouverts" :
    `⏰ ${formatKickoff(match.kickoff)}`;

  return (
    <div className="bg-gradient-card rounded-xl border border-border overflow-hidden shadow-card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className={`text-[10px] font-display tracking-wider ${statusColor}`}>
          {statusLabel}
        </span>
        {match.stats?.system && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-fire/30 text-fire">
            {match.stats.system === "attack" ? <><Swords size={10} className="mr-0.5" />ATK</> :
             match.stats.system === "defensive" ? <><Shield size={10} className="mr-0.5" />DEF</> :
             <><Target size={10} className="mr-0.5" />{match.stats.system}</>}
          </Badge>
        )}
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-display font-bold text-foreground truncate">{match.home}</p>
          </div>
          {match.status === "live" || match.status === "finished" ? (
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
    results,
    ranking,
    loading,
    scraping,
    lastUpdate,
    error,
    autoScrapeActive,
    fetchMatches,
    refreshData,
    startAutoRefresh,
    stopAutoRefresh,
  } = useLiveMatches();

  const {
    stats: predStats,
    savePrediction,
    verifyPredictions,
    loading: predLoading
  } = usePredictions();

  const [predictingId, setPredictingId] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Record<string, MatchResult>>({});
  const [activeTab, setActiveTab] = useState("matches");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetchMatches();
  }, []);

  const toggleAutoRefresh = () => {
    if (autoScrapeActive) {
      stopAutoRefresh();
    } else {
      startAutoRefresh();
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

      // Build team stats map from ranking data
      const teamStatsMap = buildTeamStatsMap(ranking);
      
      // Prepare historical results
      const historicalResults = prepareHistoricalResults(results);

      // Local prediction (no external AI needed)
      const result = analyzeMatch(matchInput, undefined, teamStatsMap, historicalResults);
      await saveToHistory(result);
      setPredictions(prev => ({ ...prev, [matchKey]: result }));
      
      // Save prediction to database for tracking
      try {
        await savePrediction({
          match_id: match.id,
          home_team: match.home,
          away_team: match.away,
          league: match.league,
          odd_home: match.oddHome,
          odd_draw: match.oddDraw,
          odd_away: match.oddAway,
          prob_home: result.probHome,
          prob_draw: result.probDraw,
          prob_away: result.probAway,
          prediction: result.winner1X2.startsWith('1') ? '1' : result.winner1X2.startsWith('2') ? '2' : 'X',
          confidence: result.aiConfidence * 100,
          predicted_home_score: result.scoreHome,
          predicted_away_score: result.scoreAway,
          predicted_score: result.exactScore,
          // Champs supplémentaires pour éviter N/A
          winner_1x2: result.winner1X2,
          gg_result: result.ggResult,
          total_goals: result.totalGoals,
          parity: result.parity,
          over_under_15: result.overUnder15,
          over_under_25: result.overUnder25,
          over_under_35: result.overUnder35,
          prob_gg: result.probGG,
          prob_gn: result.probGN,
          btts_prob: result.bttsProb,
          over25_prob: result.over25Prob,
          first_half_goal_prob: result.firstHalfGoalProb,
          expected_goals: result.expectedGoals,
        });
      } catch (e) {
        console.log('Prediction already saved or error:', e);
      }
      
      toast.success("Prédiction générée 🔥");
    } catch {
      toast.error("Erreur lors de la prédiction");
    } finally {
      setPredictingId(null);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const result = await verifyPredictions();
      console.log('Verify result:', result);
      
      if (result?.success) {
        if (result.verified > 0) {
          toast.success(`✅ Vérifié: ${result.correct} correct, ${result.incorrect} incorrect`);
        } else {
          toast.info('Aucun résultat trouvé pour les prédictions en attente');
        }
      } else {
        toast.info(result?.message || 'Aucune prédiction à vérifier');
      }
    } catch (err) {
      console.error('Verify error:', err);
      let msg = err instanceof Error ? err.message : 'Erreur lors de la vérification';
      
      // Messages d'erreur spécifiques
      if (msg.includes('Edge Function non trouvée')) {
        toast.error('⚠️ Edge Function non déployée. Déployez "verify-predictions" depuis Supabase.');
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        toast.error('Connexion impossible. Essayez depuis Termux avec: python3 verify_all.py');
      } else if (msg.includes('403') || msg.includes('API')) {
        toast.error('API bloquée. Exécutez depuis Madagascar: python3 verify_all.py');
      } else {
        toast.error(msg);
      }
    } finally {
      setVerifying(false);
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
              Instant League
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
              variant={autoScrapeActive ? "default" : "outline"}
              onClick={toggleAutoRefresh}
              className={`text-xs ${autoScrapeActive ? "bg-gradient-fire text-primary-foreground" : ""}`}
            >
              {autoScrapeActive ? <Wifi size={14} /> : <WifiOff size={14} />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refreshData()}
              disabled={loading || scraping}
              className="text-xs"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        {(totalMatches > 0 || results.length > 0 || ranking.length > 0) && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {totalMatches > 0 && (
              <Badge variant="secondary" className="text-[10px] font-display">
                ⚽ {totalMatches} Matchs
              </Badge>
            )}
            {results.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-display">
                📊 {results.length} Résultats
              </Badge>
            )}
            {ranking.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-display">
                🏆 {ranking.length} Équipes
              </Badge>
            )}
            {autoScrapeActive && (
              <Badge className="text-[10px] font-display bg-success/20 text-success border-success/30">
                🔄 Auto 30s
              </Badge>
            )}
          </div>
        )}

        {/* Prediction Stats */}
        {predStats && predStats.total > 0 && (
          <div className="bg-gradient-card rounded-xl border border-border p-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-fire" />
                <span className="text-xs font-display font-bold text-foreground">Précision des Prédictions</span>
              </div>
              <div className="flex items-center gap-1">
                {predStats.accuracy >= 70 ? (
                  <CheckCircle size={12} className="text-success" />
                ) : predStats.accuracy >= 50 ? (
                  <TrendingUp size={12} className="text-gold" />
                ) : (
                  <XCircle size={12} className="text-destructive" />
                )}
                <span className={`text-sm font-display font-black ${
                  predStats.accuracy >= 70 ? 'text-success' : 
                  predStats.accuracy >= 50 ? 'text-gold' : 'text-destructive'
                }`}>
                  {predStats.accuracy}%
                </span>
              </div>
            </div>
            
            <Progress value={predStats.accuracy} className="h-2 mb-2" />
            
            <div className="grid grid-cols-3 gap-2 text-center text-[9px]">
              <div className="bg-muted/50 rounded p-1">
                <span className="text-muted-foreground block">Vérifiées</span>
                <span className="font-bold text-foreground">{predStats.correct + predStats.incorrect}</span>
              </div>
              <div className="bg-success/10 rounded p-1">
                <span className="text-muted-foreground block">Correctes</span>
                <span className="font-bold text-success">{predStats.correct}</span>
              </div>
              <div className="bg-destructive/10 rounded p-1">
                <span className="text-muted-foreground block">Incorrectes</span>
                <span className="font-bold text-destructive">{predStats.incorrect}</span>
              </div>
            </div>
            
            {predStats.pending > 0 && (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[9px] text-muted-foreground">
                  {predStats.pending} en attente (v2.8)
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleVerify}
                  disabled={verifying}
                  className="text-[9px] h-6"
                >
                  {verifying ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <><Eye size={10} className="mr-1" /> Vérifier</>
                  )}
                </Button>
              </div>
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
          </div>
        )}

        {/* Loading state */}
        {loading && totalMatches === 0 && results.length === 0 && ranking.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 size={32} className="text-fire animate-spin" />
            <p className="text-sm text-muted-foreground font-display tracking-wider">
              Chargement des données...
            </p>
          </div>
        )}

        {/* Tabs: Matches / Results / Ranking */}
        {!loading && (totalMatches > 0 || results.length > 0 || ranking.length > 0) && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full grid grid-cols-3 mb-4">
              <TabsTrigger value="matches" className="text-xs font-display gap-1">
                <Swords size={12} /> Matchs
              </TabsTrigger>
              <TabsTrigger value="results" className="text-xs font-display gap-1">
                <BarChart3 size={12} /> Résultats
              </TabsTrigger>
              <TabsTrigger value="ranking" className="text-xs font-display gap-1">
                <ListOrdered size={12} /> Classement
              </TabsTrigger>
            </TabsList>

            <TabsContent value="matches">
              {leagues.length > 0 ? (
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
              ) : (
                <div className="text-center py-8">
                  <Swords size={32} className="mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground font-display">Aucun match en cours</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="results">
              {results.length > 0 ? (
                <ResultsList results={results} />
              ) : (
                <div className="text-center py-8">
                  <BarChart3 size={32} className="mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground font-display">Aucun résultat disponible</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="ranking">
              {ranking.length > 0 ? (
                <div className="bg-gradient-card rounded-xl border border-border overflow-hidden p-3">
                  <RankingTable ranking={ranking} />
                </div>
              ) : (
                <div className="text-center py-8">
                  <ListOrdered size={32} className="mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground font-display">Aucun classement disponible</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        {/* Empty state */}
        {!loading && totalMatches === 0 && results.length === 0 && ranking.length === 0 && !error && (
          <div className="text-center py-12">
            <Trophy size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground font-display">Aucune donnée trouvée</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Les données se mettent à jour automatiquement
            </p>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
