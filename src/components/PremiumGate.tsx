import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Key, ShieldCheck, Loader2, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { validateCode, setAccess, getAccess, verifyPremium, clearAccess, requestMagicLinkActivation, hasUserSession } from "@/lib/storage";
import { toast } from "sonner";

interface PremiumGateProps {
  onUnlocked: () => void;
}

type FlowMode = 'legacy' | 'email';

type EmailStep = 'input' | 'sent';

export default function PremiumGate({ onUnlocked }: PremiumGateProps) {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [serverConfirmed, setServerConfirmed] = useState(false);
  const [flowMode, setFlowMode] = useState<FlowMode>('email');
  const [emailStep, setEmailStep] = useState<EmailStep>('input');

  // ALWAYS check the server — even if localStorage is empty.
  // This handles: browser clears data on close, new device, etc.
  // The server is the source of truth for premium status.
  useEffect(() => {
    verifyPremium().then((result) => {
      if (result === true) {
        setServerConfirmed(true);
      } else if (result === 'offline') {
        const access = getAccess();
        setServerConfirmed(!!access);
      } else {
        clearAccess();
        setServerConfirmed(false);
      }
      setVerifying(false);
    }).catch(() => {
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
    const isUserAccount = hasUserSession();
    return (
      <div className="bg-gradient-card rounded-xl border border-success/30 p-4 flex items-center gap-3">
        <ShieldCheck className="text-success" size={20} />
        <div>
          <p className="text-sm font-semibold text-success">Premium Actif</p>
          <p className="text-xs text-muted-foreground">
            {daysLeft > 0 ? `${daysLeft} jours restants` : 'Premium actif (vérifié par serveur)'}
            {isUserAccount && ' · Compte email lié'}
          </p>
        </div>
      </div>
    );
  }

  // ── Email + Code magic link flow ──
  if (flowMode === 'email') {
    if (emailStep === 'sent') {
      return (
        <div className="bg-gradient-card rounded-xl border border-ice/30 p-4 sm:p-6 shadow-card space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="text-ice" size={20} />
            <h3 className="font-display text-sm text-ice tracking-wider">EMAIL ENVOYÉ</h3>
          </div>

          <p className="text-xs text-muted-foreground">
            Si un compte existe avec <span className="text-foreground font-semibold">{email}</span>,
            tu recevras un lien d'activation sous quelques instants.
          </p>

          <p className="text-xs text-muted-foreground">
            Clique sur le lien dans l'email pour finaliser l'activation de ton code premium.
            Le lien expire dans 15 minutes.
          </p>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setEmailStep('input'); setEmail(""); setCode(""); setError(""); }}
              className="text-muted-foreground"
            >
              <ArrowLeft size={14} className="mr-1" /> Recommencer
            </Button>
          </div>
        </div>
      );
    }

    const handleEmailSubmit = async () => {
      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        setError("Email invalide");
        return;
      }
      if (!code.trim()) {
        setError("Veuillez entrer un code");
        return;
      }

      setLoading(true);
      setError("");

      const result = await requestMagicLinkActivation(trimmedEmail, code.trim());
      if (result.success) {
        setEmailStep('sent');
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
          Entre ton email et ton code premium. Un lien de vérification sera envoyé à ton email.
        </p>

        <div className="space-y-2">
          <div className="relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="email"
              placeholder="Ton adresse email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(""); }}
              className="bg-muted border-border font-display text-sm tracking-wider pl-9"
              disabled={loading}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Code premium (VRL-XXXX-XXXX)"
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setError(""); }}
              className="bg-muted border-border font-display text-sm tracking-wider flex-1"
              onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
              disabled={loading}
            />
            <Button
              onClick={handleEmailSubmit}
              disabled={loading}
              className="bg-gradient-premium text-background font-display tracking-wider flex-shrink-0"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <><Key size={14} className="mr-1" /> ACTIVER</>}
            </Button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-destructive flex items-start gap-1">
            <span>!</span>
            <span className="break-words">{error}</span>
          </p>
        )}

        <button
          onClick={() => { setFlowMode('legacy'); setError(""); }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Activation directe par code (ancien dispositif)
        </button>
      </div>
    );
  }

  // ── Legacy direct code flow ──
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
        <h3 className="font-display text-sm text-gold tracking-wider">ACCÈS PREMIUM (DIRECT)</h3>
      </div>

      <p className="text-xs text-muted-foreground">
        Entre ton code d'accès pour activer le premium directement sur cet appareil.
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

      <button
        onClick={() => { setFlowMode('email'); setError(""); }}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Activation par email + code (nouveau)
      </button>
    </div>
  );
}
