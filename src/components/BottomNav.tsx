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
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-border">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
        {items.map(item => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center gap-0.5 transition-colors ${
                active ? "text-fire" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <item.icon size={20} className={active ? "glow-fire" : ""} />
              <span className="text-[10px] font-display tracking-wider">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
