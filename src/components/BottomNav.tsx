import { Home, Clock, ShoppingBag, Settings, Shield, Trophy } from "lucide-react";
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
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass-premium border-t border-border/50 safe-area-bottom lg:hidden">
      {/* Scrollable container for navigation items */}
      <div className="overflow-x-auto scrollbar-hide">
        <div 
          className="flex items-center h-16 px-1 py-1.5 gap-1"
          style={{ 
            minWidth: 'fit-content',
            justifyContent: items.length <= 5 ? 'space-around' : 'flex-start'
          }}
        >
          {items.map((item) => {
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`
                  nav-item flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl
                  transition-all duration-300 relative group flex-shrink-0 min-w-[44px] min-h-[44px] justify-center
                  ${active
                    ? "text-fire bg-fire/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }
                `}
              >
                {/* Active indicator glow */}
                {active && (
                  <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-gradient-fire rounded-full shadow-fire" />
                )}

                <item.icon
                  size={18}
                  className={`
                    transition-all duration-300 flex-shrink-0
                    ${active ? "glow-fire scale-110" : "group-hover:scale-105"}
                  `}
                />
                <span className="text-[9px] font-display tracking-wider font-medium whitespace-nowrap">
                  {item.label}
                </span>

                {/* Hover ripple effect */}
                <span className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                  <span className="absolute inset-0 rounded-xl bg-fire/5" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
