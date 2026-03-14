import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Key, ShieldCheck } from "lucide-react";
import { validateCode, setAccess, isPremium, getAccess } from "@/lib/storage";
import { toast } from "sonner";

interface PremiumGateProps {
  onUnlocked: () => void;
}

export default function PremiumGate({ onUnlocked }: PremiumGateProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isPremium()) {
    const access = getAccess();
    const daysLeft = access ? Math.ceil((access.expiresAt - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
    return (
      <div className="bg-gradient-card rounded-xl border border-success/30 p-4 flex items-center gap-3">
        <ShieldCheck className="text-success" size={20} />
        <div>
          <p className="text-sm font-semibold text-success">Premium Actif</p>
          <p className="text-xs text-muted-foreground">{daysLeft} jours restants</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    setLoading(true);
    const result = await validateCode(code.trim());
    if (result.valid) {
      setAccess(code.trim(), result.days);
      toast.success("Premium débloqué ! 🔥");
      setError("");
      onUnlocked();
    } else {
      setError("Code invalide. Achetez un code premium.");
    }
    setLoading(false);
  };

  return (
    <div className="bg-gradient-card rounded-xl border border-gold/30 p-6 shadow-card space-y-4">
      <div className="flex items-center gap-2">
        <Lock className="text-gold" size={20} />
        <h3 className="font-display text-sm text-gold tracking-wider">ACCÈS PREMIUM REQUIS</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Entrez votre code d'accès pour débloquer le score exact, GG/GN, total de buts et plus.
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="Entrez le code premium"
          value={code}
          onChange={e => { setCode(e.target.value); setError(""); }}
          className="bg-muted border-border font-display text-sm tracking-wider"
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
        />
        <Button onClick={handleSubmit} disabled={loading} className="bg-gradient-premium text-background font-display tracking-wider">
          <Key size={14} className="mr-1" /> ACTIVER
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
