import { useState, useEffect } from "react";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import ResultCard from "@/components/ResultCard";
import { Button } from "@/components/ui/button";
import { getHistory, clearHistory } from "@/lib/storage";
import type { MatchResult } from "@/lib/prediction-engine";
import { Trash2, Clock } from "lucide-react";

export default function History() {
  const [history, setHistory] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory().then(data => { setHistory(data); setLoading(false); });
  }, []);

  const handleClear = async () => {
    await clearHistory();
    setHistory([]);
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-4">
        <AppHeader />
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-ice" />
            <h2 className="font-display text-sm tracking-widest uppercase text-foreground">Historique</h2>
          </div>
          {history.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear} className="text-destructive text-xs">
              <Trash2 size={14} className="mr-1" /> Effacer
            </Button>
          )}
        </div>
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">Chargement...</p>
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Clock size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aucune prédiction enregistrée</p>
          </div>
        ) : (
          <div className="space-y-4">
            {history.map(r => (
              <div key={r.id}>
                <p className="text-[10px] text-muted-foreground mb-1">
                  {new Date(r.timestamp).toLocaleString("fr-FR")}
                </p>
                <ResultCard result={r} />
              </div>
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
