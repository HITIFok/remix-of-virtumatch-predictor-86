import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { config } from "@/config/env";
import { setUserSession, setAccess } from "@/lib/storage";
import { toast } from "sonner";

type VerifyState = 'loading' | 'success' | 'error';

export default function AuthVerify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<VerifyState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [email, setEmail] = useState('');
  const [premiumInfo, setPremiumInfo] = useState<{ days: number; expiresAt: string } | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setState('error');
      setErrorMsg('Token manquant dans l\'URL.');
      return;
    }

    // Call the verify endpoint
    (async () => {
      try {
        const res = await fetch(config.api.authVerify, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          setState('error');
          setErrorMsg(data.error || 'Lien invalide ou expiré.');
          return;
        }

        // Store user session
        if (data.token && data.email) {
          setUserSession(data.token, data.email, data.expiresIn || 30 * 24 * 60 * 60 * 1000);
          setEmail(data.email);
        }

        // If premium was activated as part of this verification, store it locally
        if (data.premium?.activated) {
          setAccess(
            'magic-link',
            data.premium.days || 30,
            data.premium.expires_at,
          );
          setPremiumInfo({
            days: data.premium.days || 30,
            expiresAt: data.premium.expires_at,
          });
          toast.success(`Premium activé pour ${data.premium.days || 30} jours !`);
        } else {
          toast.success('Connexion réussie !');
        }

        setState('success');
      } catch (err: any) {
        setState('error');
        setErrorMsg(err.message || 'Erreur de connexion au serveur.');
      }
    })();
  }, [searchParams]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-x-hidden">
        <div className="absolute inset-0 -z-10 animated-multicolor" />
        <div className="relative z-10 text-center space-y-4">
          <div className="relative inline-block">
            <Loader2 size={48} className="text-ice animate-spin" />
            <div className="absolute inset-0 blur-xl bg-ice/30 rounded-full" />
          </div>
          <div>
            <p className="font-display text-sm text-foreground tracking-wider">VÉRIFICATION EN COURS...</p>
            <p className="text-xs text-muted-foreground mt-1">Activation de ton compte</p>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-x-hidden">
        <div className="absolute inset-0 -z-10 animated-multicolor" />
        <div className="relative z-10 text-center space-y-4 max-w-sm mx-auto px-4">
          <XCircle size={48} className="text-destructive mx-auto" />
          <div>
            <p className="font-display text-sm text-foreground tracking-wider">ÉCHEC DE LA VÉRIFICATION</p>
            <p className="text-xs text-muted-foreground mt-2">{errorMsg}</p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="font-display text-xs text-ice tracking-wider hover:text-foreground transition-colors"
          >
            Retour à l'accueil
          </button>
        </div>
      </div>
    );
  }

  // state === 'success'
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-x-hidden">
      <div className="absolute inset-0 -z-10 animated-multicolor" />
      <div className="relative z-10 text-center space-y-4 max-w-sm mx-auto px-4">
        <CheckCircle2 size={48} className="text-success mx-auto" />
        <div>
          <p className="font-display text-sm text-success tracking-wider">COMPTE ACTIVÉ</p>
          <p className="text-xs text-muted-foreground mt-2">
            {email && <>Connecté en tant que <span className="text-foreground font-semibold">{email}</span></>}
          </p>
        </div>

        {premiumInfo && (
          <div className="bg-success/10 border border-success/30 rounded-xl p-3 space-y-1">
            <div className="flex items-center justify-center gap-2">
              <ShieldCheck size={16} className="text-gold" />
              <p className="font-display text-xs text-gold tracking-wider">PREMIUM ACTIVÉ</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {premiumInfo.days} jours d'accès premium
            </p>
            <p className="text-xs text-muted-foreground">
              Expire le {new Date(premiumInfo.expiresAt).toLocaleDateString('fr-FR')}
            </p>
          </div>
        )}

        <button
          onClick={() => navigate('/')}
          className="font-display text-xs text-ice tracking-wider hover:text-foreground transition-colors mt-4"
        >
          Accéder à VirtuMatch
        </button>
      </div>
    </div>
  );
}
