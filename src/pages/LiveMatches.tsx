import { useState, useEffect } from "react";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AnimatedBackground from "@/components/AnimatedBackground";
import { useLiveMatches } from "@/hooks/use-live-matches";
import { usePredictions } from "@/hooks/use-predictions";
import { isPremium } from "@/lib/storage";
import { analyzeMatch, buildTeamStatsMap, prepareHistoricalResults, type MatchInput, type MatchResult } from "@/lib/prediction-engine";
import { saveToHistory } from "@/lib/storage";
import ResultCard from "@/components/ResultCard";
import { RankingTable, ResultsList } from "@/components/LeagueData";
import { toast } from "sonner";
import {
  RefreshCw, Loader2, Clock, Trophy, Lock, Zap,
  Shield, Swords, Target, AlertTriangle, BarChart3, ListOrdered
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ScrapedMatch } from "@/lib/types";
import FlagIcon from "@/components/FlagIcon";

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
    <div className="card-premium overflow-hidden scroll-item">
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
            variant="fire"
            className="w-full"
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
          <div className="flex items-center justify-center gap-1.5 py-2.5 bg-gold/10 rounded-xl border border-gold/30 card-glow-gold">
            <Lock size={12} className="text-gold" />
            <span className="text-[10px] font-display text-gold tracking-wider font-bold">PREMIUM REQUIS</span>
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
    selectedLeagueId,
    selectedLeague,
    availableLeagues,
    fetchMatches,
    refreshData,
    changeLeague,
    dataSource,
  } = useLiveMatches();

  const { savePrediction } = usePredictions();

  const [predictingId, setPredictingId] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Record<string, MatchResult>>({});
  const [activeTab, setActiveTab] = useState("matches");

  useEffect(() => {
    fetchMatches();
  }, []);

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

      const teamStatsMap = buildTeamStatsMap(ranking);
      const historicalResults = prepareHistoricalResults(results);
      const result = analyzeMatch(matchInput, undefined, teamStatsMap, historicalResults);

      setPredictions(prev => ({ ...prev, [matchKey]: result }));

      // Save prediction to database (single save)
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
          confidence: result.aiConfidence, // Already a percentage (0-100)
          predicted_home_score: result.scoreHome,
          predicted_away_score: result.scoreAway,
          predicted_score: result.exactScore,
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

  const leagues = Object.keys(matchesByLeague);
  const totalMatches = Object.values(matchesByLeague).reduce((s, m) => s + m.length, 0);

  return (
    <div className="min-h-screen pb-24 relative overflow-x-hidden page-enter">
      <AnimatedBackground />
      <div className="container-responsive relative z-10">
        <AppHeader />

        {/* League Selector */}
        <div className="mb-4">
          <Select
            value={selectedLeagueId}
            onValueChange={(value) => changeLeague(value as any)}
            disabled={loading || scraping}
          >
            <SelectTrigger className="w-full bg-gradient-card border-border">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <FlagIcon countryCode={selectedLeague.countryCode} />
                  <span className="font-display font-bold">{selectedLeague.name}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableLeagues.map((league) => (
                <SelectItem key={league.id} value={league.id}>
                  <span className="flex items-center gap-2">
                    <FlagIcon countryCode={league.countryCode} />
                    <span className="font-display">{league.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-sm text-gradient-fire tracking-wider flex items-center gap-2 font-bold">
              <FlagIcon countryCode={selectedLeague.countryCode} size={18} />
              {selectedLeague.name}
            </h2>
            {lastUpdate && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                <Clock size={10} />
                Maj: {new Date(lastUpdate).toLocaleTimeString("fr-FR")}
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshData()}
            disabled={loading || scraping}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </Button>
        </div>

        {/* Stats bar */}
        {(totalMatches > 0 || results.length > 0 || ranking.length > 0) && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {totalMatches > 0 && (
              <Badge variant="secondary" className="text-[10px] font-display bg-muted/50 border-border/50">
                ⚽ {totalMatches} Matchs
              </Badge>
            )}
            {results.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-display bg-muted/50 border-border/50">
                📊 {results.length} Résultats
              </Badge>
            )}
            {ranking.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-display bg-muted/50 border-border/50">
                🏆 {ranking.length} Équipes
              </Badge>
            )}
            {dataSource === "api" && (
              <Badge className="text-[10px] font-display bg-success/20 text-success border-success/30 animate-pulse">
                🟢 Temps réel
              </Badge>
            )}
            {dataSource === "cache" && (
              <Badge className="text-[10px] font-display bg-gold/20 text-gold border-gold/30">
                📦 Cache
              </Badge>
            )}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="card-premium card-glow-fire border-destructive/30 p-3 mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-destructive" />
              <span className="text-xs text-destructive">{error}</span>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && totalMatches === 0 && results.length === 0 && ranking.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12">
            <div className="relative">
              <Loader2 size={32} className="text-fire animate-spin" />
              <div className="absolute inset-0 blur-lg bg-fire/30 rounded-full" />
            </div>
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
                <div className="card-premium overflow-hidden p-3">
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
