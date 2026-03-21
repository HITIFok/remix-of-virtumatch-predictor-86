import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AnimatedBackground from "@/components/AnimatedBackground";
import MatchForm from "@/components/MatchForm";
import ResultCard from "@/components/ResultCard";
import PremiumGate from "@/components/PremiumGate";
import { analyzeMatch, type MatchInput, type MatchResult, type AIPrediction } from "@/lib/prediction-engine";
import { saveToHistory } from "@/lib/storage";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sparkles, TrendingUp } from "lucide-react";

export default function Index() {
  const [results, setResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [, forceUpdate] = useState(0);

  const handleAnalyze = async (matches: MatchInput[]) => {
    setLoading(true);
    try {
      // Call AI edge function
      const { data, error } = await supabase.functions.invoke("analyze-match", {
        body: { matches },
      });

      let aiPredictions: (AIPrediction | undefined)[] = [];

      if (error) {
        console.warn("AI analysis failed, using math fallback:", error);
        toast.error("IA indisponible, analyse mathématique utilisée");
        aiPredictions = matches.map(() => undefined);
      } else if (data?.error) {
        console.warn("AI error:", data.error);
        toast.error(data.error);
        aiPredictions = matches.map(() => undefined);
      } else {
        aiPredictions = (data?.predictions || []) as AIPrediction[];
        // Pad if AI returned fewer results
        while (aiPredictions.length < matches.length) {
          aiPredictions.push(undefined);
        }
      }

      const analyzed = matches.map((m, i) => analyzeMatch(m, aiPredictions[i]));

      for (const r of analyzed) {
        await saveToHistory(r);
      }
      setResults(analyzed);
      toast.success(`${analyzed.length} match(s) analysé(s) avec l'IA 🔥`);
    } catch (err) {
      console.error("Analysis error:", err);
      // Full fallback
      const analyzed = matches.map((m) => analyzeMatch(m));
      for (const r of analyzed) {
        await saveToHistory(r);
      }
      setResults(analyzed);
      toast.error("Analyse IA échouée, résultats mathématiques affichés");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pb-24 relative overflow-x-hidden">
      <AnimatedBackground />
      <div className="container-responsive relative z-10">
        <AppHeader />
        <PremiumGate onUnlocked={() => forceUpdate((n) => n + 1)} />
        <div className="mt-6">
          <MatchForm onAnalyze={handleAnalyze} loading={loading} />
        </div>
        {results.length > 0 && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="text-fire" size={16} />
              <h2 className="font-display text-sm text-gradient-fire tracking-widest uppercase font-bold">
                Résultats d'analyse
              </h2>
              <Sparkles className="text-gold animate-bounce-subtle" size={14} />
            </div>
            {results.map((r) => (
              <ResultCard key={r.id} result={r} />
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
