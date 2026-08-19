import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AnimatedBackground from "@/components/AnimatedBackground";
import MatchForm from "@/components/MatchForm";
import ResultCard from "@/components/ResultCard";
import PremiumGate from "@/components/PremiumGate";
import { analyzeMatch, type MatchInput, type MatchResult, type AIPrediction } from "@/lib/prediction-engine";
import { saveToHistory } from "@/lib/storage";
import { config } from "@/config/env";
import { getAuthHeaders } from "@/lib/device";
import { toast } from "sonner";
import { Sparkles, TrendingUp, Download, Smartphone } from "lucide-react";
import { APK_DOWNLOAD_URL } from "@/config/env";

export default function Index() {
  const [results, setResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [premiumRefreshKey, setPremiumRefreshKey] = useState(0);

  const handleAnalyze = async (matches: MatchInput[]) => {
    setLoading(true);
    try {
      // Call AI API route
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`${config.api.analyzeMatchUrl}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches }),
      });
      const aiData = await res.json();

      let aiPredictions: (AIPrediction | undefined)[] = [];

      if (!res.ok || aiData.error) {
        console.warn("AI analysis failed, using math fallback:", aiData.error);
        toast.error("IA indisponible, analyse mathématique utilisée");
        aiPredictions = matches.map(() => undefined);
      } else {
        aiPredictions = (aiData?.predictions || []) as AIPrediction[];
        // Pad if AI returned fewer results
        while (aiPredictions.length < matches.length) {
          aiPredictions.push(undefined);
        }
      }

      const analyzed = matches.map((m, i) => analyzeMatch(m, aiPredictions[i]));

      // Affichage instantané — sauvegarde en arrière-plan
      setResults(analyzed);
      toast.success(`${analyzed.length} match(s) analysé(s) avec l'IA 🔥`);
      Promise.all(analyzed.map(r => saveToHistory(r).catch(() => {})));
    } catch (err) {
      console.error("Analysis error:", err);
      // Full fallback
      const analyzed = matches.map((m) => analyzeMatch(m));
      setResults(analyzed);
      toast.error("Analyse IA échouée, résultats mathématiques affichés");
      Promise.all(analyzed.map(r => saveToHistory(r).catch(() => {})));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pb-24 relative overflow-x-hidden page-enter">
      <AnimatedBackground />
      <div className="container-responsive relative z-10">
        <AppHeader />
        <PremiumGate onUnlocked={() => setPremiumRefreshKey(k => k + 1)} />

        {/* APK Download Banner */}
        {APK_DOWNLOAD_URL && (
          <button
            type="button"
            onClick={() => { const a = document.createElement("a"); a.href = APK_DOWNLOAD_URL; a.download = ""; a.click(); }}
            onMouseEnter={() => { (window as unknown as { status: string }).status = ""; }}
            className="mt-4 w-full flex items-center gap-3 p-3.5 rounded-2xl border border-fire/30 bg-gradient-to-r from-fire/10 to-gold/10 hover:from-fire/20 hover:to-gold/20 transition-all duration-300 group cursor-pointer"
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-fire/20 flex items-center justify-center group-hover:bg-fire/30 transition-colors">
              <Smartphone size={20} className="text-fire" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-display font-bold text-foreground">
                Installer l'application Android
              </p>
              <p className="text-[10px] text-muted-foreground">
                Téléchargez l'APK pour une expérience optimale
              </p>
            </div>
            <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-fire flex items-center justify-center group-hover:scale-105 transition-transform">
              <Download size={16} className="text-white" />
            </div>
          </button>
        )}

        <div className="mt-6">
          <MatchForm onAnalyze={handleAnalyze} loading={loading} />
        </div>
        {results.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="text-fire" size={16} />
              <h2 className="font-display text-sm text-gradient-fire tracking-widest uppercase font-bold">
                Résultats d'analyse
              </h2>
              <Sparkles className="text-gold animate-bounce-subtle" size={14} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {results.map((r) => (
                <ResultCard key={r.id} result={r} />
              ))}
            </div>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}