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
    await saveGeneratedCode(gc);
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
    
    if (confirm(`Supprimer le code ${code} ?`)) {
      const success = await deleteGeneratedCode(codeId);
      if (success) {
        // Mettre à jour la liste en filtrant le code supprimé localement
        setCodes(prev => prev.filter(c => c.id !== codeId));
        toast.success("Code supprimé");
      } else {
        toast.error("Erreur lors de la suppression");
      }
    }
  };

  if (!isAdmin()) return null;

  return (
    <div className="min-h-screen pb-24 relative">
      <AnimatedBackground />
      <div className="container-responsive relative z-10">
        <AppHeader />

        <div className="flex items-center gap-2 mb-4">
          <Shield className="text-fire" size={20} />
          <h2 className="font-display text-sm tracking-widest uppercase text-foreground">Admin — Gestion des codes</h2>
        </div>

        <div className="flex gap-3 mb-6">
          <Button onClick={() => handleGenerate(30)} className="flex-1 bg-gradient-fire text-primary-foreground font-display text-xs tracking-wider">
            <Plus size={14} className="mr-1" /> Code 1 mois
          </Button>
          <Button onClick={() => handleGenerate(60)} className="flex-1 bg-gradient-ice text-secondary-foreground font-display text-xs tracking-wider">
            <Plus size={14} className="mr-1" /> Code 2 mois
          </Button>
        </div>

        {loading ? (
          <p className="text-center text-sm text-muted-foreground py-8">Chargement...</p>
        ) : (
          <div className="space-y-3">
            {codes.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">Aucun code généré</p>
            ) : (
              codes.map((gc, i) => (
                <div
                  key={gc.id || i}
                  className={`bg-gradient-card rounded-lg border p-4 flex items-center justify-between ${
                    gc.used ? "border-muted opacity-60" : "border-gold/30"
                  }`}
                >
                  <div>
                    <p className="font-display text-sm tracking-wider text-foreground">{gc.code}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {gc.durationDays} jours • {gc.used ? `Utilisé` : "Disponible"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Créé le {new Date(gc.createdAt).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!gc.used && (
                      <button onClick={() => copyCode(gc.code)} className="text-gold hover:text-fire transition-colors">
                        {copiedId === gc.code ? <Check size={18} /> : <Copy size={18} />}
                      </button>
                    )}
                    <button 
                      onClick={() => handleDelete(gc.id, gc.code)} 
                      className="text-destructive hover:text-red-400 transition-colors"
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
