import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import { BookOpen, MessageCircle, Phone } from "lucide-react";

const steps = [
  { title: "Entrez les cotes", desc: "Saisissez la cote domicile, nul et extérieur d'un match virtuel." },
  { title: "Analysez", desc: "L'algorithme calcule automatiquement toutes les probabilités et prédictions." },
  { title: "Résultats gratuits", desc: "1X2 et probabilité de but en 1ère mi-temps sont accessibles gratuitement." },
  { title: "Débloquez le Premium", desc: "Entrez votre code premium pour voir le score exact, GG/GN, total de buts, over/under et parité." },
  { title: "Historique", desc: "Toutes vos prédictions sont sauvegardées automatiquement dans l'historique." },
];

export default function Guide() {
  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-4">
        <AppHeader />

        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="text-ice" size={20} />
          <h2 className="font-display text-sm tracking-widest uppercase text-foreground">Guide d'utilisation</h2>
        </div>

        <div className="space-y-3 mb-6">
          {steps.map((s, i) => (
            <div key={i} className="bg-gradient-card rounded-lg border border-border p-4 flex gap-3">
              <div className="w-7 h-7 rounded-full bg-gradient-fire flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold font-display text-primary-foreground">{i + 1}</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{s.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-gradient-card rounded-xl border border-border p-5 shadow-card">
          <h3 className="font-display text-sm text-gradient-ice tracking-wider uppercase mb-3">Contact</h3>
          <div className="space-y-2">
            <a
              href="https://wa.me/+261331443048"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-success/10 border border-success/30 rounded-lg p-3 hover:bg-success/20 transition-colors"
            >
              <MessageCircle size={18} className="text-success" />
              <div>
                <p className="text-sm font-semibold text-foreground">WhatsApp</p>
                <p className="text-xs text-muted-foreground">0331443048</p>
              </div>
            </a>
            <a
              href="https://facebook.com/NgU darker"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-ice/10 border border-ice/30 rounded-lg p-3 hover:bg-ice/20 transition-colors"
            >
              <Phone size={18} className="text-ice" />
              <div>
                <p className="text-sm font-semibold text-foreground">Facebook</p>
                <p className="text-xs text-muted-foreground">NgU darker</p>
              </div>
            </a>
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
