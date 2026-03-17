import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AnimatedBackground from "@/components/AnimatedBackground";
import { Crown, Phone, MessageCircle, Sparkles, Shield, Zap } from "lucide-react";

const plans = [
  { duration: "1 mois", price: "15 000 Ar", value: 15000, popular: false },
  { duration: "2 mois", price: "25 000 Ar", value: 25000, popular: true },
];

export default function Shop() {
  return (
    <div className="min-h-screen bg-background pb-24 relative">
      <AnimatedBackground />
      <div className="max-w-lg mx-auto px-4 relative z-10">
        <AppHeader />

        <div className="flex items-center gap-2 mb-6">
          <Crown className="text-gold animate-glow" size={22} />
          <h2 className="font-display text-sm tracking-widest uppercase text-gradient-premium font-bold">
            Boutique Premium
          </h2>
          <Sparkles size={14} className="text-gold animate-bounce-subtle" />
        </div>

        <div className="space-y-4 mb-6">
          {plans.map((plan) => (
            <div
              key={plan.duration}
              className={`card-premium p-5 relative overflow-hidden ${
                plan.popular ? 'card-glow-gold' : ''
              }`}
            >
              {plan.popular && (
                <div className="absolute top-0 right-0 bg-gradient-premium px-4 py-1.5 rounded-bl-xl rounded-tr-xl">
                  <span className="text-[10px] font-display font-bold text-background tracking-wider">POPULAIRE</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-premium flex items-center justify-center shadow-lg">
                  <Crown size={24} className="text-background" />
                </div>
                <div>
                  <h3 className="font-display text-lg text-gradient-premium font-bold">{plan.duration}</h3>
                  <p className="text-2xl font-display font-black text-foreground">{plan.price}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Accès complet à toutes les prédictions premium</p>
              
              {/* Features */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Zap size={12} className="text-fire" />
                  <span>Prédictions illimitées</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Shield size={12} className="text-ice" />
                  <span>Support prioritaire</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card-premium p-5 space-y-4">
          <h3 className="font-display text-sm text-gradient-fire tracking-wider uppercase font-bold flex items-center gap-2">
            Comment acheter ?
          </h3>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-fire flex items-center justify-center flex-shrink-0 shadow-lg shadow-fire/30">
                <span className="text-sm font-bold text-white font-display">1</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Transférer via MVola</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Envoyez le montant au numéro :
                </p>
                <p className="font-display text-sm text-fire mt-1 tracking-wider font-bold">+261 38 30 610 76</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-ice flex items-center justify-center flex-shrink-0 shadow-lg shadow-ice/30">
                <span className="text-sm font-bold text-white font-display">2</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Contacter l'admin</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Après le transfert, contactez l'admin pour recevoir votre code d'accès premium.
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-border/50 pt-4 space-y-3">
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
