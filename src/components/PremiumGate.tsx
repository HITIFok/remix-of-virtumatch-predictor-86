import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Key, ShieldCheck, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { validateCode, setAccess, isPremium, getAccess, testSupabaseConnection } from "@/lib/storage";
import { toast } from "sonner";

interface PremiumGateProps {
  onUnlocked: () => void;
}

export default function PremiumGate({ onUnlocked }: PremiumGateProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);

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

  const handleTestConnection = async () => {
    const result = await testSupabaseConnection();
    setConnectionOk(result.success);
    return result;
  };

  const handleSubmit = async () => {
    if (!code.trim()) {
      setError("Veuillez entrer un code");
      return;
    }
    
    setLoading(true);
    setError("");
    
    // Test connection first
    const connectionTest = await handleTestConnection();
    if (!connectionTest.success) {
      setError(`Connexion échouée: ${connectionTest.message}`);
      setLoading(false);
      return;
    }
    
    const result = await validateCode(code.trim());
    if (result.valid) {
      setAccess(code.trim(), result.days);
      toast.success(result.message);
      setError("");
      onUnlocked();
    } else {
      setError(result.message);
    }
    setLoading(false);
  };

  return (
    <div className="bg-gradient-card rounded-xl border border-gold/30 p-4 sm:p-6 shadow-card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="text-gold" size={20} />
          <h3 className="font-display text-sm text-gold tracking-wider">ACCÈS PREMIUM REQUIS</h3>
        </div>
        {connectionOk !== null && (
          connectionOk ? 
            <Wifi size={14} className="text-success" /> : 
            <WifiOff size={14} className="text-destructive" />
        )}
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
          {loading ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <><Key size={14} className="mr-1" /> ACTIVER</>
          )}
        </Button>
      </div>
      
      {error && (
        <p className="text-xs text-destructive flex items-start gap-1">
          <span className="text-destructive">⚠️</span>
          <span className="break-words">{error}</span>
        </p>
      )}
      
      {connectionOk === false && (
        <p className="text-xs text-muted-foreground">
          Vérifiez votre connexion internet ou réessayez plus tard.
        </p>
      )}
    </div>
  );
}
