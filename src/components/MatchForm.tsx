import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Zap, Loader2 } from "lucide-react";
import type { MatchInput } from "@/lib/prediction-engine";
import { AVAILABLE_LEAGUES, type LeagueInfo } from "@/hooks/use-live-matches";

interface MatchFormProps {
  onAnalyze: (matches: MatchInput[]) => void;
  loading?: boolean;
}

import FlagIcon from "@/components/FlagIcon";

const emptyMatch = (): MatchInput => ({
  home: "",
  away: "",
  league: AVAILABLE_LEAGUES[0].name,
  oddHome: 0,
  oddDraw: 0,
  oddAway: 0,
});

export default function MatchForm({ onAnalyze, loading }: MatchFormProps) {
  const [matches, setMatches] = useState<MatchInput[]>([emptyMatch()]);

  const updateMatch = (idx: number, field: keyof MatchInput, value: string) => {
    setMatches(prev => {
      const copy = [...prev];
      if (field === "home" || field === "away" || field === "league") {
        copy[idx] = { ...copy[idx], [field]: value };
      } else {
        copy[idx] = { ...copy[idx], [field]: parseFloat(value) || 0 };
      }
      return copy;
    });
  };

  const addMatch = () => setMatches(prev => [...prev, emptyMatch()]);
  const removeMatch = (idx: number) => setMatches(prev => prev.filter((_, i) => i !== idx));

  const canAnalyze = !loading && matches.every(
    m => m.home.trim() && m.away.trim() && m.oddHome > 1 && m.oddDraw > 1 && m.oddAway > 1
  );

  return (
    <div className="space-y-4 max-w-2xl mx-auto lg:max-w-3xl">
      {matches.map((m, idx) => (
        <div key={idx} className="bg-gradient-card rounded-lg p-4 shadow-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-display text-muted-foreground tracking-widest uppercase">
              Match {idx + 1}
            </span>
            {matches.length > 1 && (
              <button onClick={() => removeMatch(idx)} className="text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 size={16} />
              </button>
            )}
          </div>

          {/* League selector - Identique à LiveMatches */}
          <Select value={m.league} onValueChange={v => updateMatch(idx, "league", v)}>
            <SelectTrigger className="w-full bg-gradient-card border-border">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <FlagIcon countryCode={AVAILABLE_LEAGUES.find(l => l.name === m.league)?.countryCode || "gb-eng"} />
                  <span className="font-display font-bold">{m.league}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_LEAGUES.map((league) => (
                <SelectItem key={league.id} value={league.name}>
                  <span className="flex items-center gap-2">
                    <FlagIcon countryCode={league.countryCode} />
                    <span className="font-display">{league.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input
              placeholder="Équipe domicile"
              value={m.home}
              onChange={e => updateMatch(idx, "home", e.target.value)}
              className="bg-muted border-border font-medium"
            />
            <Input
              placeholder="Équipe extérieur"
              value={m.away}
              onChange={e => updateMatch(idx, "away", e.target.value)}
              className="bg-muted border-border font-medium"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Cote Dom</label>
              <Input
                type="number"
                step="0.01"
                min="1.01"
                placeholder="1.56"
                value={m.oddHome || ""}
                onChange={e => updateMatch(idx, "oddHome", e.target.value)}
                className="bg-muted border-border text-center font-display text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Cote Nul</label>
              <Input
                type="number"
                step="0.01"
                min="1.01"
                placeholder="3.56"
                value={m.oddDraw || ""}
                onChange={e => updateMatch(idx, "oddDraw", e.target.value)}
                className="bg-muted border-border text-center font-display text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Cote Ext</label>
              <Input
                type="number"
                step="0.01"
                min="1.01"
                placeholder="5.67"
                value={m.oddAway || ""}
                onChange={e => updateMatch(idx, "oddAway", e.target.value)}
                className="bg-muted border-border text-center font-display text-sm"
              />
            </div>
          </div>
        </div>
      ))}

      <div className="flex gap-3">
        <Button variant="outline" onClick={addMatch} disabled={loading} className="flex-1 border-dashed border-muted-foreground/30">
          <Plus size={16} className="mr-1" /> Ajouter un match
        </Button>
        <Button
          onClick={() => canAnalyze && onAnalyze(matches)}
          disabled={!canAnalyze}
          className="flex-1 bg-gradient-fire text-primary-foreground font-display tracking-wider shadow-fire hover:opacity-90 transition-opacity"
        >
          {loading ? (
            <><Loader2 size={16} className="mr-1 animate-spin" /> ANALYSE IA...</>
          ) : (
            <><Zap size={16} className="mr-1" /> ANALYSER 🔥</>
          )}
        </Button>
      </div>
    </div>
  );
}
