import { Home, Clock, ShoppingBag, Settings, HelpCircle, Shield, Trophy } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { isAdmin } from "@/lib/storage";

const navItems = [
  { path: "/", icon: Home, label: "Accueil" },
  { path: "/live", icon: Trophy, label: "Matchs" },
  { path: "/history", icon: Clock, label: "Historique" },
  { path: "/shop", icon: ShoppingBag, label: "Boutique" },
  { path: "/settings", icon: Settings, label: "Réglages" },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const admin = isAdmin();

  const items = admin
    ? [...navItems, { path: "/admin", icon: Shield, label: "Admin" }]
    : navItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass-premium border-t border-border/50">
      <div className="flex justify-around items-center h-18 max-w-lg mx-auto px-2 py-2">
        {items.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`
                nav-item flex flex-col items-center gap-1 px-3 py-2 rounded-xl
                transition-all duration-300 relative group
                ${active
                  ? "text-fire bg-fire/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                }
              `}
            >
              {/* Active indicator glow */}
              {active && (
                <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-8 h-1 bg-gradient-fire rounded-full shadow-fire" />
              )}

              <item.icon
                size={20}
                className={`
                  transition-all duration-300
                  ${active ? "glow-fire scale-110" : "group-hover:scale-105"}
                `}
              />
              <span className="text-[10px] font-display tracking-wider font-medium">
                {item.label}
              </span>

              {/* Hover ripple effect */}
              <span className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                <span className="absolute inset-0 rounded-xl bg-fire/5 animate-pulse" />
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
