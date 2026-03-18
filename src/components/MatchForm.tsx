import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Zap, Loader2 } from "lucide-react";
import type { MatchInput } from "@/lib/prediction-engine";

interface MatchFormProps {
  onAnalyze: (matches: MatchInput[]) => void;
  loading?: boolean;
}

// Composant pour afficher un drapeau (identique à LiveMatches)
function FlagIcon({ countryCode, size = 20 }: { countryCode: string; size?: number }) {
  // Coupe d'Afrique - Carte de l'Afrique avec Madagascar
  if (countryCode === "africa") {
    return (
      <svg width={size} height={size * 0.9} viewBox="0 0 50 45" className="inline-block">
        <rect width="50" height="45" fill="#FCD116" rx="2"/>
        <circle cx="25" cy="22" r="18" fill="#007A5E"/>
        <path d="M25 6 L32 12 L35 18 L34 25 L38 32 L32 36 L28 34 L25 38 L22 34 L18 36 L12 32 L16 25 L15 18 L18 12 Z" fill="#FCD116"/>
        <ellipse cx="42" cy="32" rx="4" ry="6" fill="#FCD116"/>
        <circle cx="12" cy="10" r="2" fill="white"/>
        <circle cx="38" cy="10" r="2" fill="white"/>
        <circle cx="8" cy="22" r="1.5" fill="white"/>
        <circle cx="42" cy="22" r="1.5" fill="white"/>
      </svg>
    );
  }
  // Champions League - Logo avec cercle argenté et étoiles
  if (countryCode === "uefa") {
    return (
      <svg width={size} height={size * 0.9} viewBox="0 0 50 45" className="inline-block">
        <rect width="50" height="45" fill="#0a1e3c" rx="2"/>
        <circle cx="25" cy="22" r="17" fill="none" stroke="#c0c0c0" strokeWidth="2"/>
        <circle cx="25" cy="22" r="13" fill="none" stroke="#c0c0c0" strokeWidth="1.5"/>
        <polygon points="25,4 26,7 29,7 27,9 28,12 25,10 22,12 23,9 21,7 24,7" fill="#c0c0c0"/>
        <polygon points="42,12 43,15 46,15 44,17 45,20 42,18 39,20 40,17 38,15 41,15" fill="#c0c0c0" transform="scale(0.7) translate(18, 5)"/>
        <polygon points="42,12 43,15 46,15 44,17 45,20 42,18 39,20 40,17 38,15 41,15" fill="#c0c0c0" transform="scale(0.7) translate(-5, 5)"/>
        <polygon points="42,12 43,15 46,15 44,17 45,20 42,18 39,20 40,17 38,15 41,15" fill="#c0c0c0" transform="scale(0.7) translate(18, 18)"/>
        <polygon points="42,12 43,15 46,15 44,17 45,20 42,18 39,20 40,17 38,15 41,15" fill="#c0c0c0" transform="scale(0.7) translate(-5, 18)"/>
        <polygon points="25,38 26,41 29,41 27,43 28,46 25,44 22,46 23,43 21,41 24,41" fill="#c0c0c0"/>
        <text x="25" y="26" textAnchor="middle" fill="#c0c0c0" fontSize="8" fontWeight="bold" fontFamily="sans-serif">UCL</text>
      </svg>
    );
  }
  // Europa League
  if (countryCode === "europa") {
    return (
      <svg width={size} height={size * 0.9} viewBox="0 0 50 45" className="inline-block">
        <rect width="50" height="45" fill="#1a1a2e" rx="2"/>
        <circle cx="25" cy="22" r="16" fill="none" stroke="#f39c12" strokeWidth="2"/>
        <circle cx="25" cy="22" r="12" fill="none" stroke="#f39c12" strokeWidth="1.5"/>
        <text x="25" y="26" textAnchor="middle" fill="#f39c12" fontSize="8" fontWeight="bold" fontFamily="sans-serif">UEL</text>
      </svg>
    );
  }
  // World Cup
  if (countryCode === "world") {
    return (
      <svg width={size} height={size * 0.9} viewBox="0 0 50 45" className="inline-block">
        <rect width="50" height="45" fill="#5d4e8c" rx="2"/>
        <circle cx="25" cy="22" r="15" fill="none" stroke="#ffd700" strokeWidth="2"/>
        <polygon points="25,5 27,10 32,10 28,14 30,19 25,16 20,19 22,14 18,10 23,10" fill="#ffd700"/>
        <text x="25" y="28" textAnchor="middle" fill="#ffd700" fontSize="7" fontWeight="bold" fontFamily="sans-serif">WORLD</text>
      </svg>
    );
  }
  // Angleterre
  if (countryCode === "gb-eng") {
    return (
      <svg width={size} height={size * 0.67} viewBox="0 0 60 40" className="inline-block">
        <rect width="60" height="40" fill="white"/>
        <rect x="24" width="12" height="40" fill="#CE1124"/>
        <rect y="14" width="60" height="12" fill="#CE1124"/>
        <rect x="26" width="8" height="40" fill="white"/>
        <rect y="16" width="60" height="8" fill="white"/>
      </svg>
    );
  }
  const flagColors: Record<string, [string, string, string?]> = {
    it: ["#009246", "#FFFFFF", "#CE2B37"],
    es: ["#AA151B", "#F1BF00", "#AA151B"],
    fr: ["#002395", "#FFFFFF", "#ED2939"],
    de: ["#000000", "#DD0000", "#FFCC00"],
    pt: ["#006600", "#FF0000", "#FFFF00"],
  };
  const colors = flagColors[countryCode] || ["#888", "#888", "#888"];
  return (
    <svg width={size} height={size * 0.67} viewBox="0 0 90 60" className="inline-block">
      {colors[2] ? (
        <>
          <rect width="90" height="20" fill={colors[0]}/>
          <rect y="20" width="90" height="20" fill={colors[1]}/>
          <rect y="40" width="90" height="20" fill={colors[2]}/>
        </>
      ) : (
        <rect width="90" height="60" fill={colors[0]}/>
      )}
    </svg>
  );
}

const LEAGUES = [
  { name: "English League", countryCode: "gb-eng" },
  { name: "Champions League", countryCode: "uefa" },
  { name: "Coupe d'Afrique", countryCode: "africa" },
  { name: "Liga Española", countryCode: "es" },
  { name: "Bundesliga", countryCode: "de" },
  { name: "Serie A", countryCode: "it" },
  { name: "Ligue 1", countryCode: "fr" },
  { name: "World Cup", countryCode: "world" },
  { name: "Europa League", countryCode: "europa" },
  { name: "Autre", countryCode: "other" },
];

const emptyMatch = (): MatchInput => ({
  home: "",
  away: "",
  league: "English League",
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
    <div className="space-y-4">
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

          {/* League selector */}
          <Select value={m.league} onValueChange={v => updateMatch(idx, "league", v)}>
            <SelectTrigger className="w-full bg-gradient-card border-border">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <FlagIcon countryCode={LEAGUES.find(l => l.name === m.league)?.countryCode || "other"} />
                  <span className="font-display font-bold">{m.league}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {LEAGUES.map(l => (
                <SelectItem key={l.name} value={l.name}>
                  <span className="flex items-center gap-2">
                    <FlagIcon countryCode={l.countryCode} />
                    <span className="font-display">{l.name}</span>
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
