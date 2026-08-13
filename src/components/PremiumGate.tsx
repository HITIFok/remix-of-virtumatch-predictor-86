import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Key, ShieldCheck, Loader2 } from "lucide-react";
import { validateCode, setAccess, getAccess, verifyPremium, clearAccess } from "@/lib/storage";
import { toast } from "sonner";

interface PremiumGateProps {
  onUnlocked: () => void;
}

export default function PremiumGate({ onUnlocked }: PremiumGateProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [serverConfirmed, setServerConfirmed] = useState(false);

  // ALWAYS check the server — even if localStorage is empty.
  // This handles: browser clears data on close, new device, etc.
  // The server is the source of truth for premium status.
  useEffect(() => {
    verifyPremium().then((result) => {
      if (result === true) {
        // Server confirmed premium → grant access (even if localStorage was empty)
        setServerConfirmed(true);
      } else if (result === 'offline') {
        // Network unreachable → trust localStorage if it has data (grace period)
        const access = getAccess();
        setServerConfirmed(!!access);
      } else {
        // Server explicitly said NOT premium → show code form
        clearAccess();
        setServerConfirmed(false);
      }
      setVerifying(false);
    }).catch(() => {
      // Network error → trust localStorage if it has data (grace period)
      const access = getAccess();
      setServerConfirmed(!!access);
      setVerifying(false);
    });
  }, []);

  if (verifying) {
    return (
      <div className="bg-gradient-card rounded-xl border border-border p-4 flex items-center justify-center gap-2">
        <Loader2 className="animate-spin text-muted-foreground" size={18} />
        <span className="text-xs text-muted-foreground">Vérification premium...</span>
      </div>
    );
  }

  if (serverConfirmed) {
    const access = getAccess();
    const daysLeft = access ? Math.ceil((access.expiresAt - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
    return (
      <div className="bg-gradient-card rounded-xl border border-success/30 p-4 flex items-center gap-3">
        <ShieldCheck className="text-success" size={20} />
        <div>
          <p className="text-sm font-semibold text-success">Premium Actif</p>
          <p className="text-xs text-muted-foreground">{daysLeft > 0 ? `${daysLeft} jours restants` : 'Premium actif (vérifié par serveur)'}</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!code.trim()) {
      setError("Veuillez entrer un code");
      return;
    }
    
    setLoading(true);
    setError("");
    
    const result = await validateCode(code.trim());
    if (result.valid) {
      setAccess(code.trim(), result.days, result.expiresAt);
      toast.success(result.message);
      setError("");
      setServerConfirmed(true);
      onUnlocked();
    } else {
      setError(result.message);
    }
    setLoading(false);
  };

  return (
    <div className="bg-gradient-card rounded-xl border border-gold/30 p-4 sm:p-6 shadow-card space-y-4">
      <div className="flex items-center gap-2">
        <Lock className="text-gold" size={20} />
        <h3 className="font-display text-sm text-gold tracking-wider">ACCÈS PREMIUM REQUIS</h3>
      </div>
      
      <p className="text-xs text-muted-foreground">
        Entrez votre code d'accès pour débloquer le score exact, GG/GN, total de buts et plus.
      </p>
      
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Entrez le code premium"
          value={code}
          onChange={e => { setCode(e.target.value); setError(""); }}
          className="bg-muted border-border font-display text-sm tracking-wider flex-1"
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          disabled={loading}
        />
        <Button 
          onClick={handleSubmit} 
          disabled={loading} 
          className="bg-gradient-premium text-background font-display tracking-wider flex-shrink-0"
        >
          <Key size={14} className="mr-1" /> ACTIVER
        </Button>
      </div>
      
      {error && (
        <p className="text-xs text-destructive flex items-start gap-1">
          <span>!</span>
          <span className="break-words">{error}</span>
        </p>
      )}
    </div>
  );
}
