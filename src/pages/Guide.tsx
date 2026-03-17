import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AnimatedBackground from "@/components/AnimatedBackground";
import { BookOpen, MessageCircle, Phone, Sparkles } from "lucide-react";

const steps = [
  { title: "Entrez les cotes", desc: "Saisissez la cote domicile, nul et extérieur d'un match virtuel.", icon: "⚽" },
  { title: "Analysez", desc: "L'algorithme calcule automatiquement toutes les probabilités et prédictions.", icon: "🧮" },
  { title: "Résultats gratuits", desc: "1X2 et probabilité de but en 1ère mi-temps sont accessibles gratuitement.", icon: "🆓" },
  { title: "Débloquez le Premium", desc: "Entrez votre code premium pour voir le score exact, GG/GN, total de buts, over/under et parité.", icon: "👑" },
  { title: "Historique", desc: "Toutes vos prédictions sont sauvegardées automatiquement dans l'historique.", icon: "📊" },
];

export default function Guide() {
  return (
    <div className="min-h-screen pb-24 relative">
      <AnimatedBackground />
      <div className="max-w-lg mx-auto px-4 relative z-10">
        <AppHeader />

        <div className="flex items-center gap-2 mb-6">
          <BookOpen className="text-ice animate-glow" size={20} />
          <h2 className="font-display text-sm tracking-widest uppercase text-gradient-ice font-bold">Guide d'utilisation</h2>
          <Sparkles size={14} className="text-ice animate-bounce-subtle" />
        </div>

        <div className="space-y-3 mb-6">
          {steps.map((s, i) => (
            <div key={i} className="card-premium p-4 flex gap-3 group hover:scale-[1.01] transition-transform duration-300">
              <div className="w-10 h-10 rounded-xl bg-gradient-fire flex items-center justify-center flex-shrink-0 shadow-lg shadow-fire/30 group-hover:scale-105 transition-transform">
                <span className="text-lg">{s.icon}</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground font-display">{s.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="card-premium p-5">
          <h3 className="font-display text-sm text-gradient-ice tracking-wider uppercase mb-4 font-bold flex items-center gap-2">
            Contact
          </h3>
          <div className="space-y-3">
            <a
              href="https://wa.me/+261383061076"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-success/10 border border-success/30 rounded-xl p-3.5 hover:bg-success/20 transition-all duration-300 hover:scale-[1.02]"
            >
              <div className="w-10 h-10 rounded-xl bg-success/20 flex items-center justify-center">
                <MessageCircle size={20} className="text-success" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">WhatsApp</p>
                <p className="text-xs text-muted-foreground">0383061076</p>
              </div>
            </a>
            <a
              href="https://facebook.com/hitif"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-ice/10 border border-ice/30 rounded-xl p-3.5 hover:bg-ice/20 transition-all duration-300 hover:scale-[1.02]"
            >
              <div className="w-10 h-10 rounded-xl bg-ice/20 flex items-center justify-center">
                <Phone size={20} className="text-ice" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Facebook</p>
                <p className="text-xs text-muted-foreground">hitif</p>
              </div>
            </a>
          </div>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
