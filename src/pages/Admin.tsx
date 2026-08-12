import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AnimatedBackground from "@/components/AnimatedBackground";
import { Button } from "@/components/ui/button";
import {
  isAdmin,
  generateRandomCode,
  saveGeneratedCode,
  getGeneratedCodes,
  deleteGeneratedCode,
  verifyAdminSession,
  type GeneratedCode,
} from "@/lib/storage";
import { Shield, Plus, Copy, Check, Trash2, Loader2, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

// ─── Validation côté serveur ───────────────────────────────────────────────────
// Utilise verifyAdminSession() de storage.ts qui gère Web vs APK automatiquement
// Web → vérifie le token HMAC via API Route Vercel
// APK → vérifie l'expiration locale (pas de fetch cross-origin)

// ─── Composant ────────────────────────────────────────────────────────────────
export default function Admin() {
  const navigate = useNavigate();
  const [codes, setCodes] = useState<GeneratedCode[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // État de vérification serveur en cours (bloque les boutons pendant la vérif)
  const [verifying, setVerifying] = useState(false);

  // ── Migration state ──
  const [fromDevice, setFromDevice] = useState("");
  const [toDevice, setToDevice] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);

  // ── Garde d'accès au montage ────────────────────────────────────────────────
  useEffect(() => {
    // Vérification client rapide (UX)
    if (!isAdmin()) {
      navigate("/settings");
      return;
    }

    // Vérification serveur au montage
    let cancelled = false;
    (async () => {
      const valid = await verifyAdminSession();
      if (cancelled) return;
      if (!valid) {
        toast.error("Session admin invalide ou expirée. Reconnectez-vous.");
        navigate("/settings");
        return;
      }
      const data = await getGeneratedCodes();
      if (!cancelled) {
        setCodes(data);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [navigate]);

  // ── Génération de code ──────────────────────────────────────────────────────
  // Re-vérifie le token côté serveur avant chaque génération.
  const handleGenerate = useCallback(async (days: number) => {
    setVerifying(true);
    try {
      const valid = await verifyAdminSession();
      if (!valid) {
        toast.error("Session expirée. Reconnectez-vous.");
        navigate("/settings");
        return;
      }

      const code = generateRandomCode();
      const gc: GeneratedCode = {
        code,
        createdAt: Date.now(),
        durationDays: days,
        used: false,
      };

      const result = await saveGeneratedCode(gc);
      if (!result.success) {
        toast.error(`Erreur : ${result.message}`);
        return;
      }

      const updated = await getGeneratedCodes();
      setCodes(updated);
      toast.success(`Code généré : ${code}`);
    } finally {
      setVerifying(false);
    }
  }, [navigate]);

  // ── Suppression de code ─────────────────────────────────────────────────────
  // Re-vérifie le token côté serveur avant chaque suppression.
  const handleDelete = useCallback(async (codeId: string | undefined, code: string) => {
    if (!codeId) {
      toast.error("ID du code introuvable");
      return;
    }
    if (!confirm(`Supprimer le code ${code} ?`)) return;

    setVerifying(true);
    try {
      const valid = await verifyAdminSession();
      if (!valid) {
        toast.error("Session expirée. Reconnectez-vous.");
        navigate("/settings");
        return;
      }

      const success = await deleteGeneratedCode(codeId);
      if (success) {
        setCodes(prev => prev.filter(c => c.id !== codeId));
        toast.success("Code supprimé");
      } else {
        toast.error("Erreur lors de la suppression");
      }
    } finally {
      setVerifying(false);
    }
  }, [navigate]);

  // ── Copie ───────────────────────────────────────────────────────────────────
  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(code);
    toast.success("Code copié !");
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── Migration device_id ──
  const handleMigrate = useCallback(async () => {
    if (!fromDevice.trim() || !toDevice.trim()) {
      toast.error("Remplissez les deux device_id");
      return;
    }
    if (fromDevice === toDevice) {
      toast.error("Les device_id doivent être différents");
      return;
    }

    setMigrating(true);
    setMigrateResult(null);
    try {
      const valid = await verifyAdminSession();
      if (!valid) {
        toast.error("Session expirée.");
        navigate("/settings");
        return;
      }

      const adminToken = localStorage.getItem("virtuxxs_admin_session");
      const token = adminToken ? JSON.parse(adminToken).token : "";

      const res = await fetch("/api/admin-migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ from_device_id: fromDevice.trim(), to_device_id: toDevice.trim(), migrate_premium: true }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || "Erreur de migration");
        return;
      }

      const r = data.result;
      setMigrateResult(`${r.migrated} prédictions migrées, ${r.conflicts} conflits ignorés. Premium: ${r.premium_action || 'non migré'}`);
      toast.success(`Migration réussie: ${r.migrated} prédictions`);
    } catch (err: any) {
      toast.error(`Erreur: ${err.message}`);
    } finally {
      setMigrating(false);
    }
  }, [fromDevice, toDevice, navigate]);

  // Garde client (double check au rendu)
  if (!isAdmin()) return null;

  return (
    <div className="min-h-screen pb-24 relative overflow-x-hidden page-enter">
      <AnimatedBackground />
      <div className="container-responsive relative z-10">
        <AppHeader />

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Shield className="text-fire flex-shrink-0" size={20} />
          <h2 className="font-display text-sm tracking-widest uppercase text-foreground">
            Admin — Gestion des codes
          </h2>
          {verifying && (
            <Loader2 size={14} className="animate-spin text-muted-foreground ml-auto" />
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <Button
            onClick={() => handleGenerate(30)}
            disabled={verifying}
            className="flex-1 bg-gradient-fire text-primary-foreground font-display text-xs tracking-wider"
          >
            {verifying
              ? <Loader2 size={14} className="mr-1 animate-spin" />
              : <Plus size={14} className="mr-1" />
            }
            Code 1 mois
          </Button>
          <Button
            onClick={() => handleGenerate(60)}
            disabled={verifying}
            className="flex-1 bg-gradient-ice text-secondary-foreground font-display text-xs tracking-wider"
          >
            {verifying
              ? <Loader2 size={14} className="mr-1 animate-spin" />
              : <Plus size={14} className="mr-1" />
            }
            Code 2 mois
          </Button>
        </div>

        {loading ? (
          <p className="text-center text-sm text-muted-foreground py-8">Chargement...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {codes.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8 col-span-full">
                Aucun code généré
              </p>
            ) : (
              codes.map((gc, i) => (
                <div
                  key={gc.id || i}
                  className={`bg-gradient-card rounded-lg border p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    gc.used ? "border-muted opacity-60" : "border-gold/30"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm tracking-wider text-foreground break-all">
                      {gc.code}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {gc.durationDays} jours • {gc.used ? "Utilisé" : "Disponible"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Créé le {new Date(gc.createdAt).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
                    {!gc.used && (
                      <button
                        onClick={() => copyCode(gc.code)}
                        className="text-gold hover:text-fire transition-colors p-1"
                      >
                        {copiedId === gc.code ? <Check size={18} /> : <Copy size={18} />}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(gc.id, gc.code)}
                      disabled={verifying}
                      className="text-destructive hover:text-red-400 transition-colors p-1 disabled:opacity-40"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Migration Device ID ── */}
      <div className="mt-8 bg-gradient-card rounded-xl border border-gold/30 p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="text-gold" size={18} />
          <h3 className="font-display text-xs text-gold tracking-widest uppercase">
            Migration Device ID
          </h3>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Migrez les prédictions et le premium d'un ancien device_id vers le nouveau.
          Utile quand l'utilisateur a perdu son device_id (redémarrage PC, cache vidé).
        </p>
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-display block mb-1">
              Ancien device_id (source)
            </label>
            <input
              type="text"
              value={fromDevice}
              onChange={(e) => setFromDevice(e.target.value)}
              placeholder="dev-1234567890-abcdef12"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-display block mb-1">
              Nouveau device_id (destination)
            </label>
            <input
              type="text"
              value={toDevice}
              onChange={(e) => setToDevice(e.target.value)}
              placeholder="dev-abcdef1234"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50"
            />
          </div>
          <Button
            onClick={handleMigrate}
            disabled={migrating || verifying || !fromDevice.trim() || !toDevice.trim()}
            className="w-full bg-gradient-premium text-background font-display text-xs tracking-wider"
          >
            {migrating
              ? <Loader2 size={14} className="mr-1 animate-spin" />
              : <ArrowRightLeft size={14} className="mr-1" />
            }
            Migrer les données
          </Button>
          {migrateResult && (
            <p className="text-[10px] text-success font-display bg-success/10 rounded-lg p-2 border border-success/20">
              {migrateResult}
            </p>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
