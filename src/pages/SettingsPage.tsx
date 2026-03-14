import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings, Shield, LogOut } from "lucide-react";
import { getAccess, isPremium, isAdmin, loginAdmin, logoutAdmin } from "@/lib/storage";
import { toast } from "sonner";

export default function SettingsPage() {
  const [adminPwd, setAdminPwd] = useState("");
  const [, forceUpdate] = useState(0);

  const premium = isPremium();
  const access = getAccess();
  const admin = isAdmin();

  const handleAdminLogin = () => {
    if (loginAdmin(adminPwd)) {
      toast.success("Accès admin activé");
      setAdminPwd("");
      forceUpdate(n => n + 1);
    } else {
      toast.error("Mot de passe incorrect");
    }
  };

  const handleAdminLogout = () => {
    logoutAdmin();
    toast.info("Déconnexion admin");
    forceUpdate(n => n + 1);
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-4">
        <AppHeader />

        <div className="flex items-center gap-2 mb-4">
          <Settings className="text-ice" size={20} />
          <h2 className="font-display text-sm tracking-widest uppercase text-foreground">Réglages</h2>
        </div>

        {/* Premium status */}
        <div className="bg-gradient-card rounded-xl border border-border p-5 shadow-card mb-4">
          <h3 className="font-display text-xs text-muted-foreground tracking-wider uppercase mb-3">Statut Premium</h3>
          {premium && access ? (
            <div className="space-y-1">
              <p className="text-sm text-success font-semibold">✅ Premium Actif</p>
              <p className="text-xs text-muted-foreground">
                Code : {access.code}
              </p>
              <p className="text-xs text-muted-foreground">
                Expire : {new Date(access.expiresAt).toLocaleDateString("fr-FR")}
              </p>
              <p className="text-xs text-muted-foreground">
                Jours restants : {Math.ceil((access.expiresAt - Date.now()) / (1000 * 60 * 60 * 24))}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gold">🔒 Non premium — Achetez un code dans la boutique</p>
          )}
        </div>

        {/* Admin access */}
        <div className="bg-gradient-card rounded-xl border border-border p-5 shadow-card mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={16} className="text-fire" />
            <h3 className="font-display text-xs text-muted-foreground tracking-wider uppercase">Accès Administrateur</h3>
          </div>
          {admin ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-success font-semibold">Admin connecté</p>
              <Button variant="ghost" size="sm" onClick={handleAdminLogout} className="text-destructive">
                <LogOut size={14} className="mr-1" /> Déconnexion
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Mot de passe admin"
                value={adminPwd}
                onChange={e => setAdminPwd(e.target.value)}
                className="bg-muted border-border text-sm"
                onKeyDown={e => e.key === "Enter" && handleAdminLogin()}
              />
              <Button onClick={handleAdminLogin} className="bg-gradient-fire text-primary-foreground font-display text-xs">
                Entrer
              </Button>
            </div>
          )}
        </div>

        {/* App info */}
        <div className="bg-gradient-card rounded-xl border border-border p-5 shadow-card">
          <h3 className="font-display text-xs text-muted-foreground tracking-wider uppercase mb-3">À propos</h3>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>VirtuXXS by NGU 🔥🥶</p>
            <p>Version 1.0.0</p>
            <p>Prédiction de matchs virtuels garantie par algorithme</p>
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
