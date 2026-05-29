import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AnimatedBackground from "@/components/AnimatedBackground";
import { Button } from "@/components/ui/button";
import { isAdmin, generateRandomCode, saveGeneratedCode, getGeneratedCodes, deleteGeneratedCode, type GeneratedCode } from "@/lib/storage";
import { Shield, Plus, Copy, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Admin() {
  const navigate = useNavigate();
  const [codes, setCodes] = useState<GeneratedCode[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin()) {
      navigate("/settings");
      return;
    }
    getGeneratedCodes().then(data => { setCodes(data); setLoading(false); });
  }, [navigate]);

const handleGenerate = async (days: number) => {
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
    return; // ← STOP ici, ne pas recharger la liste
  }

  const updated = await getGeneratedCodes();
  setCodes(updated);
  toast.success(`Code généré : ${code}`);
};

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(code);
    toast.success("Code copié !");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (codeId: string | undefined, code: string) => {
    if (!codeId) {
      toast.error("ID du code introuvable");
      return;
    }

    // Demander le mot de passe admin pour confirmation sécurisée
    const adminPwd = prompt(`Supprimer le code ${code}\n\nMot de passe admin :`);
    if (!adminPwd) return; // Annulé par l'utilisateur

    const success = await deleteGeneratedCode(codeId, adminPwd);
    if (success) {
      setCodes(prev => prev.filter(c => c.id !== codeId));
      toast.success("Code supprimé");
    } else {
      toast.error("Mot de passe incorrect ou erreur");
    }
  };

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
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <Button 
            onClick={() => handleGenerate(30)} 
            className="flex-1 bg-gradient-fire text-primary-foreground font-display text-xs tracking-wider"
          >
            <Plus size={14} className="mr-1" /> Code 1 mois
          </Button>
          <Button 
            onClick={() => handleGenerate(60)} 
            className="flex-1 bg-gradient-ice text-secondary-foreground font-display text-xs tracking-wider"
          >
            <Plus size={14} className="mr-1" /> Code 2 mois
          </Button>
        </div>

        {loading ? (
          <p className="text-center text-sm text-muted-foreground py-8">Chargement...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {codes.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8 col-span-full">Aucun code généré</p>
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
                      {gc.durationDays} jours • {gc.used ? `Utilisé` : "Disponible"}
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
                      className="text-destructive hover:text-red-400 transition-colors p-1"
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
      <BottomNav />
    </div>
  );
}
