import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AnimatedBackground from "@/components/AnimatedBackground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings, Shield, LogOut, Sparkles, Crown, Info } from "lucide-react";
import { getAccess, isPremium, isAdmin, loginAdmin, logoutAdmin, clearAccess } from "@/lib/storage";
import { toast } from "sonner";

export default function SettingsPage() {
  const [adminPwd, setAdminPwd] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [, forceUpdate] = useState(0);

  const premium = isPremium();
  const access = getAccess();
  const admin = isAdmin();

  const handleAdminLogin = async () => {
    setAdminLoading(true);
    try {
      const success = await loginAdmin(adminPwd);
      if (success) {
        toast.success("Accès admin activé");
        setAdminPwd("");
        forceUpdate(n => n + 1);
      } else {
        toast.error("Mot de passe incorrect");
      }
    } catch (error) {
      toast.error("Erreur de connexion");
    } finally {
      setAdminLoading(false);
    }
  };

  const handleAdminLogout = () => {
    logoutAdmin();
    toast.info("Déconnexion admin");
    forceUpdate(n => n + 1);
  };

  const handlePremiumLogout = () => {
    clearAccess();
    toast.info("Accès premium supprimé");
    forceUpdate(n => n + 1);
  };

  const handleResetAll = () => {
    if (confirm("Déconnecter tous les accès (Admin + Premium) ?")) {
      logoutAdmin();
      clearAccess();
      toast.success("Tous les accès ont été réinitialisés");
      forceUpdate(n => n + 1);
    }
  };

  return (
    <div className="min-h-screen pb-24 relative">
      <AnimatedBackground />
      <div className="container-responsive relative z-10">
        <AppHeader />

        <div className="flex items-center gap-2 mb-6">
          <Settings className="text-ice animate-glow" size={20} />
          <h2 className="font-display text-sm tracking-widest uppercase text-gradient-ice font-bold">Réglages</h2>
          <Sparkles size={14} className="text-ice animate-bounce-subtle" />
        </div>

        {/* Premium status */}
        <div className="card-premium card-glow-gold p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Crown size={16} className="text-gold" />
            <h3 className="font-display text-xs text-muted-foreground tracking-wider uppercase">Statut Premium</h3>
          </div>
          {premium && access ? (
            <div className="space-y-2">
              <p className="text-sm text-success font-semibold font-display flex items-center gap-2">
                <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
                Premium Actif
              </p>
              <div className="bg-muted/30 rounded-xl p-3 border border-border/30 space-y-1">
                <p className="text-xs text-muted-foreground">
                  Code : <span className="text-foreground font-bold">{access.code}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Expire : <span className="text-foreground font-bold">{new Date(access.expiresAt).toLocaleDateString("fr-FR")}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Jours restants : <span className="text-gold font-bold">{Math.ceil((access.expiresAt - Date.now()) / (1000 * 60 * 60 * 24))}</span>
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={handlePremiumLogout} className="text-destructive hover:bg-destructive/10 w-full mt-2">
                <LogOut size={14} className="mr-1" /> Déconnexion Premium
              </Button>
            </div>
          ) : (
            <p className="text-sm text-gold">🔒 Non premium — Achetez un code dans la boutique</p>
          )}
        </div>

        {/* Admin access */}
        <div className="card-premium p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={16} className="text-fire animate-glow" />
            <h3 className="font-display text-xs text-muted-foreground tracking-wider uppercase">Accès Administrateur</h3>
          </div>
          {admin ? (
            <div className="flex items-center justify-between bg-success/10 rounded-xl p-3 border border-success/30">
              <p className="text-sm text-success font-semibold font-display">Admin connecté</p>
              <Button variant="ghost" size="sm" onClick={handleAdminLogout} className="text-destructive hover:bg-destructive/10">
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
                className="input-premium flex-1"
                onKeyDown={e => e.key === "Enter" && handleAdminLogin()}
                disabled={adminLoading}
              />
              <Button variant="fire" onClick={handleAdminLogin} disabled={adminLoading}>
                {adminLoading ? "..." : "Entrer"}
              </Button>
            </div>
          )}
        </div>

        {/* App info */}
        <div className="card-premium p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Info size={16} className="text-ice" />
            <h3 className="font-display text-xs text-muted-foreground tracking-wider uppercase">À propos</h3>
          </div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p className="text-gradient-premium font-display font-bold">VirtuL by HITIF</p>
            <p>Version 1.0.0</p>
            <p>Prédiction de matchs virtuels garantie par algorithme</p>
          </div>
        </div>

        {/* Reset All */}
        {(premium || admin) && (
          <Button 
            variant="outline" 
            onClick={handleResetAll} 
            className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 font-display text-xs tracking-wider"
          >
            <LogOut size={14} className="mr-2" /> Réinitialiser tous les accès
          </Button>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
