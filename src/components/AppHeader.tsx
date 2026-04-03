import { Flame, Snowflake, Sparkles, Home, Clock, ShoppingBag, Settings, Trophy, Shield } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { isAdmin } from "@/lib/storage";

const navItems = [
  { path: "/", icon: Home, label: "Accueil" },
  { path: "/live", icon: Trophy, label: "Matchs" },
  { path: "/history", icon: Clock, label: "Historique" },
  { path: "/shop", icon: ShoppingBag, label: "Boutique" },
  { path: "/settings", icon: Settings, label: "Réglages" },
];

export default function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const admin = isAdmin();

  const items = admin
    ? [...navItems, { path: "/admin", icon: Shield, label: "Admin" }]
    : navItems;

  return (
    <header className="text-center py-4 lg:py-6 relative">
      {/* Glow effect behind title */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-32 h-32 bg-fire/10 rounded-full blur-3xl" />
      </div>

      <div className="relative flex items-center justify-center gap-3 mb-2">
        <Flame className="text-fire animate-glow icon-float" size={28} />
        <div className="relative">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-display font-black tracking-widest text-gradient-animated">
            VirtuL
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

      {/* Desktop navigation links */}
      <nav className="hidden lg:flex items-center justify-center gap-1 mt-4">
        {items.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-display tracking-wider
                transition-all duration-200
                ${active
                  ? "text-fire bg-fire/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }
              `}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
