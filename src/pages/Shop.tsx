import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import { Crown, Phone, MessageCircle } from "lucide-react";

const plans = [
  { duration: "1 mois", price: "15 000 Ar", value: 15000 },
  { duration: "2 mois", price: "25 000 Ar", value: 25000 },
];

export default function Shop() {
  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-lg mx-auto px-4">
        <AppHeader />

        <div className="flex items-center gap-2 mb-4">
          <Crown className="text-gold" size={20} />
          <h2 className="font-display text-sm tracking-widest uppercase text-foreground">Boutique Premium</h2>
        </div>

        <div className="space-y-4 mb-6">
          {plans.map(plan => (
            <div
              key={plan.duration}
              className="bg-gradient-card rounded-xl border border-gold/20 p-5 shadow-card relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 bg-gradient-premium px-3 py-1 rounded-bl-lg">
                <span className="text-[10px] font-display font-bold text-background tracking-wider">PREMIUM</span>
              </div>
              <h3 className="font-display text-lg text-gradient-premium font-bold">{plan.duration}</h3>
              <p className="text-2xl font-display font-black text-foreground mt-1">{plan.price}</p>
              <p className="text-xs text-muted-foreground mt-2">Accès complet à toutes les prédictions premium</p>
            </div>
          ))}
        </div>

        <div className="bg-gradient-card rounded-xl border border-border p-5 shadow-card space-y-4">
          <h3 className="font-display text-sm text-gradient-fire tracking-wider uppercase">Comment acheter ?</h3>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-fire flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary-foreground">1</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Transférer via MVola</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Envoyez le montant au numéro :
                </p>
                <p className="font-display text-sm text-fire mt-1 tracking-wider">+261 38 947 9206</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-ice flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-secondary-foreground">2</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Contacter l'admin</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Après le transfert, contactez l'admin pour recevoir votre code d'accès premium.
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-4 space-y-2">
            <a
              href="https://wa.me/+261331443048"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-success/10 border border-success/30 rounded-lg p-3 hover:bg-success/20 transition-colors"
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
              className="flex items-center gap-2 bg-ice/10 border border-ice/30 rounded-lg p-3 hover:bg-ice/20 transition-colors"
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
