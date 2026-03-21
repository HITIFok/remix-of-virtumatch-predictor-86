import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AnimatedBackground from "@/components/AnimatedBackground";
import { usePredictions, type Prediction, type AggregatedStats } from "@/hooks/use-predictions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  History as HistoryIcon, CheckCircle, XCircle, Clock,
  TrendingUp, Target, AlertTriangle, Trophy, RefreshCw, Loader2,
  BarChart3, Sparkles
} from "lucide-react";

function PredictionCard({ prediction }: { prediction: Prediction }) {
  const statusColor = 
    prediction.status === "correct" ? "card-glow-success border-success/30" :
    prediction.status === "incorrect" ? "card-glow-fire border-destructive/30" :
    "border-border";

  const statusIcon = 
    prediction.status === "correct" ? <CheckCircle size={16} className="text-success" /> :
    prediction.status === "incorrect" ? <XCircle size={16} className="text-destructive" /> :
    <Clock size={16} className="text-muted-foreground" />;

  const predictedOutcome = prediction.prediction === '1' ? prediction.home_team :
                          prediction.prediction === '2' ? prediction.away_team : 'Nul';

  const actualOutcome = prediction.actual_outcome === '1' ? prediction.home_team :
                       prediction.actual_outcome === '2' ? prediction.away_team :
                       prediction.actual_outcome === 'X' ? 'Nul' : null;

  const confidenceColor = 
    prediction.confidence >= 70 ? "text-success" :
    prediction.confidence >= 50 ? "text-gold" : "text-destructive";

  return (
    <div className={`card-premium ${statusColor} p-3 mb-3`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {statusIcon}
          <span className="text-xs font-display text-muted-foreground font-medium">
            {prediction.status === "pending" ? "En attente" :
             prediction.status === "correct" ? "Correct ✓" : "Incorrect ✗"}
          </span>
        </div>
        <Badge variant="outline" className="text-[9px] font-display">
          {prediction.league}
        </Badge>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-display font-bold text-foreground">
            {prediction.home_team} vs {prediction.away_team}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        {/* Prédiction */}
        <div className="bg-muted/30 rounded-xl p-2.5 border border-border/30">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 font-display">Prédiction</p>
          <p className="text-sm font-display font-bold text-gradient-fire">
            {prediction.predicted_score || `${prediction.predicted_home_score}-${prediction.predicted_away_score}`}
          </p>
          <p className="text-xs text-foreground font-bold">{predictedOutcome}</p>
          <p className={`text-[10px] ${confidenceColor} font-bold`}>
            Confiance: {prediction.confidence}%
          </p>
        </div>

        {/* Résultat réel */}
        <div className="bg-muted/30 rounded-xl p-2.5 border border-border/30">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 font-display">Résultat</p>
          {prediction.actual_score ? (
            <>
              <p className="text-sm font-display font-bold text-gradient-ice">{prediction.actual_score}</p>
              <p className="text-xs text-foreground font-bold">{actualOutcome}</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic">Non vérifié</p>
          )}
        </div>
      </div>

      {/* Cotes */}
      <div className="grid grid-cols-3 gap-1 mt-2 text-center text-[9px]">
        <div className="bg-muted/20 rounded-lg py-1.5 border border-border/20">
          <span className="text-muted-foreground">1:</span>
          <span className="font-bold ml-1 text-foreground">{prediction.odd_home}</span>
        </div>
        <div className="bg-muted/20 rounded-lg py-1.5 border border-border/20">
          <span className="text-muted-foreground">X:</span>
          <span className="font-bold ml-1 text-foreground">{prediction.odd_draw}</span>
        </div>
        <div className="bg-muted/20 rounded-lg py-1.5 border border-border/20">
          <span className="text-muted-foreground">2:</span>
          <span className="font-bold ml-1 text-foreground">{prediction.odd_away}</span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2 text-[9px] text-muted-foreground">
        <span>{new Date(prediction.created_at).toLocaleDateString("fr-FR")}</span>
        {prediction.verified_at && (
          <span className="text-success">Vérifié: {new Date(prediction.verified_at).toLocaleDateString("fr-FR")}</span>
        )}
      </div>
    </div>
  );
}

function StatsOverview({ stats }: { stats: AggregatedStats | null }) {
  if (!stats) return null;

  return (
    <div className="card-premium p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-fire animate-glow" />
          <span className="text-sm font-display font-bold">Précision Globale</span>
        </div>
        <div className="flex items-center gap-1">
          {stats.accuracy >= 60 ? (
            <CheckCircle size={14} className="text-success" />
          ) : stats.accuracy >= 40 ? (
            <TrendingUp size={14} className="text-gold" />
          ) : (
            <AlertTriangle size={14} className="text-destructive" />
          )}
          <span className={`text-2xl font-display font-black ${
            stats.accuracy >= 60 ? 'text-success' : 
            stats.accuracy >= 40 ? 'text-gold' : 'text-destructive'
          }`}>
            {stats.accuracy}%
          </span>
        </div>
      </div>

      <div className="progress-premium mb-3">
        <div className="progress-premium-fill" style={{ width: `${stats.accuracy}%` }} />
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
        <div className="bg-muted/30 rounded-xl p-2.5 border border-border/30">
          <span className="text-muted-foreground block">Total</span>
          <span className="font-bold text-foreground text-sm font-display">{stats.total}</span>
        </div>
        <div className="bg-success/10 rounded-xl p-2.5 border border-success/20">
          <span className="text-muted-foreground block">Correctes</span>
          <span className="font-bold text-success text-sm font-display">{stats.correct}</span>
        </div>
        <div className="bg-destructive/10 rounded-xl p-2.5 border border-destructive/20">
          <span className="text-muted-foreground block">Incorrectes</span>
          <span className="font-bold text-destructive text-sm font-display">{stats.incorrect}</span>
        </div>
        <div className="bg-gold/10 rounded-xl p-2.5 border border-gold/20">
          <span className="text-muted-foreground block">En attente</span>
          <span className="font-bold text-gold text-sm font-display">{stats.pending}</span>
        </div>
      </div>

      {/* Par type de prédiction */}
      <div className="mt-4">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-display">Par Type de Prédiction</p>
        <div className="grid grid-cols-3 gap-2 text-center text-[9px]">
          <div className="bg-muted/20 rounded-xl p-2.5 border border-border/20">
            <span className="text-muted-foreground block">Victoire Domicile (1)</span>
            <span className="font-bold text-foreground font-display">{stats.byOutcome.home.correct}/{stats.byOutcome.home.predicted}</span>
            <div className="progress-premium mt-1.5 h-1">
              <div 
                className="progress-premium-fill" 
                style={{ width: `${stats.byOutcome.home.predicted > 0 ? (stats.byOutcome.home.correct / stats.byOutcome.home.predicted) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="bg-muted/20 rounded-xl p-2.5 border border-border/20">
            <span className="text-muted-foreground block">Match Nul (X)</span>
            <span className="font-bold text-foreground font-display">{stats.byOutcome.draw.correct}/{stats.byOutcome.draw.predicted}</span>
            <div className="progress-premium mt-1.5 h-1">
              <div 
                className="progress-premium-fill bg-gradient-gold" 
                style={{ width: `${stats.byOutcome.draw.predicted > 0 ? (stats.byOutcome.draw.correct / stats.byOutcome.draw.predicted) * 100 : 0}%`, background: 'var(--gradient-premium)' }}
              />
            </div>
          </div>
          <div className="bg-muted/20 rounded-xl p-2.5 border border-border/20">
            <span className="text-muted-foreground block">Victoire Extérieur (2)</span>
            <span className="font-bold text-foreground font-display">{stats.byOutcome.away.correct}/{stats.byOutcome.away.predicted}</span>
            <div className="progress-premium mt-1.5 h-1">
              <div 
                className="progress-premium-fill" 
                style={{ width: `${stats.byOutcome.away.predicted > 0 ? (stats.byOutcome.away.correct / stats.byOutcome.away.predicted) * 100 : 0}%`, background: 'var(--gradient-ice)' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Par niveau de confiance */}
      <div className="mt-4">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-display">Par Niveau de Confiance</p>
        <div className="grid grid-cols-3 gap-2 text-center text-[9px]">
          <div className="bg-success/10 rounded-xl p-2.5 border border-success/20">
            <span className="text-muted-foreground block">Haute (≥70%)</span>
            <span className="font-bold text-success font-display">{stats.byConfidence.high.correct}/{stats.byConfidence.high.total}</span>
          </div>
          <div className="bg-gold/10 rounded-xl p-2.5 border border-gold/20">
            <span className="text-muted-foreground block">Moyenne (50-69%)</span>
            <span className="font-bold text-gold font-display">{stats.byConfidence.medium.correct}/{stats.byConfidence.medium.total}</span>
          </div>
          <div className="bg-destructive/10 rounded-xl p-2.5 border border-destructive/20">
            <span className="text-muted-foreground block">Basse (&lt;50%)</span>
            <span className="font-bold text-destructive font-display">{stats.byConfidence.low.correct}/{stats.byConfidence.low.total}</span>
          </div>
        </div>
      </div>

      {/* Précision récente */}
      <div className="mt-4 flex items-center justify-between text-[10px] bg-muted/20 rounded-xl p-2.5 border border-border/20">
        <span className="text-muted-foreground">Précision 7 derniers jours</span>
        <span className={`font-bold font-display ${stats.recentAccuracy >= 50 ? 'text-success' : 'text-destructive'}`}>
          {stats.recentAccuracy}%
        </span>
      </div>
    </div>
  );
}

export default function History() {
  const { predictions, stats, loading, refresh } = usePredictions();
  const [activeTab, setActiveTab] = useState("stats");

  const pendingPredictions = predictions.filter(p => p.status === 'pending');
  const verifiedPredictions = predictions.filter(p => p.status !== 'pending');
  const correctPredictions = predictions.filter(p => p.status === 'correct');
  const incorrectPredictions = predictions.filter(p => p.status === 'incorrect');

  return (
    <div className="min-h-screen pb-24 relative overflow-x-hidden">
      <AnimatedBackground />
      <div className="container-responsive relative z-10">
        <AppHeader />

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <HistoryIcon size={18} className="text-fire animate-glow" />
            <h2 className="font-display text-sm tracking-widest uppercase text-gradient-fire font-bold">
              Historique & Stats
            </h2>
            <Sparkles size={14} className="text-gold animate-bounce-subtle" />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refresh()}
            disabled={loading}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </Button>
        </div>

        {/* Loading state */}
        {loading && predictions.length === 0 && (
          <div className="text-center py-16">
            <div className="relative inline-block">
              <Loader2 size={32} className="text-fire animate-spin" />
              <div className="absolute inset-0 blur-lg bg-fire/30 rounded-full" />
            </div>
            <p className="text-sm text-muted-foreground mt-3 font-display tracking-wider">Chargement des prédictions...</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && predictions.length === 0 && (
          <div className="text-center py-16">
            <Target size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Aucune prédiction enregistrée</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Faites des prédictions pour voir vos statistiques ici
            </p>
          </div>
        )}

        {/* Content */}
        {predictions.length > 0 && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full grid grid-cols-3 mb-4 bg-muted/30 border border-border/30">
              <TabsTrigger value="stats" className="text-xs font-display gap-1 data-[state=active]:bg-fire/20 data-[state=active]:text-fire">
                <BarChart3 size={12} /> Stats
              </TabsTrigger>
              <TabsTrigger value="pending" className="text-xs font-display gap-1 data-[state=active]:bg-gold/20 data-[state=active]:text-gold">
                <Clock size={12} /> En attente ({pendingPredictions.length})
              </TabsTrigger>
              <TabsTrigger value="verified" className="text-xs font-display gap-1 data-[state=active]:bg-success/20 data-[state=active]:text-success">
                <Trophy size={12} /> Vérifiées
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stats">
              <StatsOverview stats={stats} />

              {/* Quick summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="card-premium card-glow-success p-4 text-center">
                  <CheckCircle size={24} className="mx-auto text-success mb-2 animate-bounce-subtle" />
                  <p className="text-3xl font-display font-black text-success">{correctPredictions.length}</p>
                  <p className="text-[10px] text-muted-foreground font-display tracking-wider">Prédictions correctes</p>
                </div>
                <div className="card-premium card-glow-fire p-4 text-center">
                  <XCircle size={24} className="mx-auto text-destructive mb-2" />
                  <p className="text-3xl font-display font-black text-destructive">{incorrectPredictions.length}</p>
                  <p className="text-[10px] text-muted-foreground font-display tracking-wider">Prédictions incorrectes</p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="pending">
              {pendingPredictions.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle size={32} className="mx-auto text-success/30 mb-2" />
                  <p className="text-sm text-muted-foreground">Toutes les prédictions ont été vérifiées</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingPredictions.map(pred => (
                    <PredictionCard key={pred.id} prediction={pred} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="verified">
              {verifiedPredictions.length === 0 ? (
                <div className="text-center py-12">
                  <Clock size={32} className="mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">Aucune prédiction vérifiée</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Les résultats seront comparés automatiquement
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {verifiedPredictions.map(pred => (
                    <PredictionCard key={pred.id} prediction={pred} />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
