import { Flame, Snowflake, Sparkles } from "lucide-react";

export default function AppHeader() {
  return (
    <header className="text-center py-6 relative">
      {/* Glow effect behind title */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-32 h-32 bg-fire/10 rounded-full blur-3xl" />
      </div>

      <div className="relative flex items-center justify-center gap-3 mb-2">
        <Flame className="text-fire animate-glow icon-float" size={28} />
        <div className="relative">
          <h1 className="text-3xl font-display font-black tracking-widest text-gradient-animated">
            VirtuXXS
          </h1>
          <Sparkles className="absolute -right-6 -top-1 text-gold animate-bounce-subtle" size={14} />
        </div>
        <Snowflake className="text-ice animate-glow icon-float" size={28} style={{ animationDelay: '-1.5s' }} />
      </div>
      <p className="text-xs font-display text-gradient-premium tracking-[0.4em] uppercase font-bold">
        by HITIF
      </p>
      <p className="text-[10px] text-muted-foreground mt-1.5 tracking-wider">
        Prédiction Virtuelle Garantie
      </p>
    </header>
  );
}
