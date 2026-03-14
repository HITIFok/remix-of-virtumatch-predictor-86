import { Flame, Snowflake } from "lucide-react";

export default function AppHeader() {
  return (
    <header className="text-center py-6">
      <div className="flex items-center justify-center gap-2 mb-1">
        <Flame className="text-fire glow-fire" size={24} />
        <h1 className="text-2xl font-display font-black tracking-widest text-gradient-fire">
          VirtuXXS
        </h1>
        <Snowflake className="text-ice glow-ice" size={24} />
      </div>
      <p className="text-xs font-display text-muted-foreground tracking-[0.3em] uppercase">
        by NGU 🔥🥶
      </p>
      <p className="text-[10px] text-muted-foreground mt-1">Prédiction Virtuelle Garantie</p>
    </header>
  );
}
