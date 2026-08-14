import { useState } from 'react';
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AnimatedBackground from "@/components/AnimatedBackground";
import {
  BookOpen, MessageCircle, Phone, Sparkles, Zap, ExternalLink,
  Copy, Check, Shield, Clock, Target, AlertTriangle, ChevronDown, ChevronUp,
  Globe, LogIn, Wallet, MousePointerClick, Bookmark
} from "lucide-react";
import { generateBookmarkletUrl } from "@/lib/bet261-link";

// ─── Original Guide Steps ─────────────────────────────────────────────────

const steps = [
  { title: "Entrez les cotes", desc: "Saisissez la cote domicile, nul et extérieur d'un match virtuel.", icon: "⚽" },
  { title: "Analysez", desc: "L'algorithme calcule automatiquement toutes les probabilités et prédictions.", icon: "🧮" },
  { title: "Résultats gratuits", desc: "1X2 et probabilité de but en 1ère mi-temps sont accessibles gratuitement.", icon: "🆓" },
  { title: "Débloquez le Premium", desc: "Entrez votre code premium pour voir le score exact, GG/GN, total de buts, over/under et parité.", icon: "👑" },
  { title: "Historique", desc: "Toutes vos prédictions sont sauvegardées automatiquement dans l'historique.", icon: "📊" },
];

// ─── Bet261 Integration Steps ───────────────────────────────────────────────

const bet261Steps = [
  {
    title: "Détectez un exploit",
    desc: "VirtuMatch détecte les résultats en avance (jusqu'à 5 secondes avant le coup d'envoi). Une notification push s'affiche avec les équipes et le score.",
    icon: <Zap size={20} className="text-fire" />,
  },
  {
    title: "Cliquez 'COPIER & PARIER'",
    desc: "Le bouton vert copie automatiquement les infos du match (équipes, score, ligue) dans votre presse-papiers et ouvre bet261.mg dans un nouvel onglet.",
    icon: <Copy size={20} className="text-emerald-400" />,
  },
  {
    title: "Connectez-vous sur bet261.mg",
    desc: "Si vous n'êtes pas connecté, entrez votre numéro de téléphone et mot de passe sur bet261.mg. Le code OTP sera envoyé par SMS.",
    icon: <LogIn size={20} className="text-gold" />,
  },
  {
    title: "Trouvez le match",
    desc: "Naviguez vers les ligues virtuelles ou utilisez la barre de recherche pour trouver le match. Les noms d'équipes sont les mêmes que sur VirtuMatch.",
    icon: <Target size={20} className="text-ice" />,
  },
  {
    title: "Sélectionnez Score Exact",
    desc: "Cliquez sur l'option 'Score Exact' dans le panneau de paris. Sélectionnez le score détecté par VirtuMatch. Les cotes sont meilleures avant le coup d'envoi !",
    icon: <MousePointerClick size={20} className="text-fire" />,
  },
  {
    title: "Entrez votre mise et pariez",
    desc: "Vérifiez votre solde dans le wallet bet261, entrez le montant de votre mise, et cliquez sur 'Parier'. Faites vite — le match va commencer !",
    icon: <Wallet size={20} className="text-emerald-400" />,
  },
];

// ─── FAQ Items ──────────────────────────────────────────────────────────────

const faqItems = [
  {
    q: "Pourquoi je ne peux pas voir mon solde bet261 dans VirtuMatch ?",
    a: "bet261.mg est un site séparé avec son propre système de connexion. Pour des raisons de sécurité, VirtuMatch ne peut pas accéder à votre compte bet261. Vous devez vérifier votre solde directement sur bet261.mg après vous être connecté.",
  },
  {
    q: "Comment aller plus vite pour placer mon pari ?",
    a: "Utilisez le bouton 'COPIER & PARIER' sur VirtuMatch : il copie les infos du match et ouvre bet261.mg automatiquement. Installez aussi le Bookmarklet VirtuMatch (voir section ci-dessous) pour voir les infos du pari en superposition directement sur bet261.mg.",
  },
  {
    q: "Le bookmarklet, c'est quoi ?",
    a: "Un bookmarklet est un petit bouton dans votre barre de favoris qui ajoute une superposition d'aide sur bet261.mg. Il vous montre les équipes, le score recommandé, et les étapes pour parier — sans quitter la page de paris.",
  },
  {
    q: "bet261.mg est géobloqué, que faire ?",
    a: "bet261.mg n'est accessible que depuis Madagascar. Si vous êtes à Madagascar et que le site ne charge pas, vérifiez que vous n'utilisez pas un VPN avec une IP étrangère. VirtuMatch fonctionne de partout — c'est bet261.mg qui nécessite une connexion malgache.",
  },
  {
    q: "Les IDs de match sont-ils les mêmes sur VirtuMatch et bet261 ?",
    a: "Oui ! Les deux applications utilisent le même fournisseur de données (Sporty-Tech). Les IDs de match détectés par VirtuMatch correspondent exactement aux mêmes événements sur bet261.mg. Le bouton 'PARIER' ouvre directement la bonne page de match.",
  },
];

// ─── FAQ Accordion Item ───────────────────────────────────────────────────

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-xs font-display font-bold text-white/80">{q}</span>
        {open ? <ChevronUp size={14} className="text-white/40 flex-shrink-0" /> : <ChevronDown size={14} className="text-white/40 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-2.5">
          <p className="text-[11px] text-white/50 leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Guide Page ───────────────────────────────────────────────────────

export default function Guide() {
  const [bookmarkletCopied, setBookmarkletCopied] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const handleCopyBookmarklet = async () => {
    try {
      const url = generateBookmarkletUrl();
      await navigator.clipboard.writeText(url);
      setBookmarkletCopied(true);
      setTimeout(() => setBookmarkletCopied(false), 3000);
    } catch {
      // Fallback
      const url = generateBookmarkletUrl();
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setBookmarkletCopied(true);
      setTimeout(() => setBookmarkletCopied(false), 3000);
    }
  };

  return (
    <div className="min-h-screen pb-24 relative overflow-x-hidden page-enter">
      <AnimatedBackground />
      <div className="container-responsive relative z-10">
        <AppHeader />

        {/* Section Toggle */}
        <div className="flex items-center gap-2 mb-6">
          <BookOpen className="text-ice animate-glow" size={20} />
          <h2 className="font-display text-sm tracking-widest uppercase text-gradient-ice font-bold">Guide d'utilisation</h2>
          <Sparkles size={14} className="text-ice animate-bounce-subtle" />
        </div>

        {/* ─── Section 1: VirtuMatch Basics ──────────────────────────────── */}
        <button
          onClick={() => setActiveSection(activeSection === 'basics' ? null : 'basics')}
          className="w-full mb-4"
        >
          <div className="card-premium p-3 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer">
            <span className="text-xs font-display font-bold text-ice tracking-wider">1. COMMENT UTILISER VIRTUMATCH</span>
            {activeSection === 'basics' ? <ChevronUp size={14} className="text-ice/60" /> : <ChevronDown size={14} className="text-ice/60" />}
          </div>
        </button>
        {activeSection === 'basics' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
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
        )}

        {/* ─── Section 2: Bet261 Integration ─────────────────────────────── */}
        <button
          onClick={() => setActiveSection(activeSection === 'bet261' ? null : 'bet261')}
          className="w-full mb-4"
        >
          <div className="card-premium p-3 flex items-center justify-between hover:bg-emerald-500/5 transition-colors cursor-pointer border-emerald-500/20">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-emerald-400" />
              <span className="text-xs font-display font-bold text-emerald-400 tracking-wider">2. PARIER RAPIDEMENT SUR BET261.MG</span>
            </div>
            {activeSection === 'bet261' ? <ChevronUp size={14} className="text-emerald-400/60" /> : <ChevronDown size={14} className="text-emerald-400/60" />}
          </div>
        </button>
        {activeSection === 'bet261' && (
          <div className="space-y-4 mb-6">
            {/* Intro Card */}
            <div className="card-premium p-4 border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent">
              <div className="flex items-start gap-3">
                <Shield size={18} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-display font-bold text-emerald-400">Comment ça marche ?</p>
                  <p className="text-xs text-white/60 mt-1 leading-relaxed">
                    VirtuMatch détecte les résultats des matchs virtuels en avance (jusqu'à quelques secondes avant le coup d'envoi).
                    Quand un exploit est détecté, vous pouvez parier sur bet261.mg AVANT que le match ne commence,
                    quand les cotes sont encore disponibles. Voici comment :
                  </p>
                </div>
              </div>
            </div>

            {/* Limitation Notice */}
            <div className="card-premium p-3 border-gold/20 bg-gold/5">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-gold mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[11px] font-display font-bold text-gold">IMPORTANT - Limitations</p>
                  <p className="text-[10px] text-white/50 mt-0.5 leading-relaxed">
                    bet261.mg est géobloqué (Madagascar uniquement) et n'a pas d'API publique.
                    VirtuMatch ne peut PAS : voir votre solde, vous connecter, ou placer un pari automatiquement.
                    Vous devez vous connecter manuellement sur bet261.mg. Ce que VirtuMatch fait :
                    copier les infos du match, ouvrir bet261.mg directement sur la bonne page, et vous guider.
                  </p>
                </div>
              </div>
            </div>

            {/* Step-by-step */}
            <div className="space-y-2">
              <p className="text-[11px] font-display text-gold tracking-wider uppercase">Etapes pour parier rapidement</p>
              {bet261Steps.map((step, i) => (
                <div key={i} className="card-premium p-3 flex items-start gap-3 group hover:scale-[1.005] transition-transform">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-display font-bold text-emerald-400">{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {step.icon}
                      <p className="text-xs font-display font-bold text-white/90">{step.title}</p>
                    </div>
                    <p className="text-[10px] text-white/50 mt-0.5 leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Open bet261 button */}
            <a
              href="https://bet261.mg"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 transition-colors text-white font-display font-bold text-xs tracking-wider shadow-lg shadow-emerald-500/20"
            >
              <Globe size={14} />
              OUVRIR BET261.MG
              <ExternalLink size={12} />
            </a>
          </div>
        )}

        {/* ─── Section 3: Bookmarklet ────────────────────────────────────── */}
        <button
          onClick={() => setActiveSection(activeSection === 'bookmarklet' ? null : 'bookmarklet')}
          className="w-full mb-4"
        >
          <div className="card-premium p-3 flex items-center justify-between hover:bg-gold/5 transition-colors cursor-pointer border-gold/20">
            <div className="flex items-center gap-2">
              <Bookmark size={14} className="text-gold" />
              <span className="text-xs font-display font-bold text-gold tracking-wider">3. BOOKMARKLET - ASSISTANT PARI</span>
            </div>
            {activeSection === 'bookmarklet' ? <ChevronUp size={14} className="text-gold/60" /> : <ChevronDown size={14} className="text-gold/60" />}
          </div>
        </button>
        {activeSection === 'bookmarklet' && (
          <div className="space-y-3 mb-6">
            <div className="card-premium p-4 border-gold/20">
              <p className="text-xs font-display font-bold text-gold mb-2">Qu'est-ce que le Bookmarklet ?</p>
              <p className="text-[10px] text-white/50 leading-relaxed">
                Le bookmarklet VirtuMatch est un petit outil que vous installez dans votre barre de favoris.
                Quand vous êtes sur bet261.mg, un simple clic affiche les informations du pari détecté
                (équipes, score recommandé) en superposition, sans quitter la page de paris.
              </p>
            </div>

            {/* Install steps */}
            <div className="card-premium p-3 space-y-2">
              <p className="text-[10px] font-display text-gold tracking-wider">Installation</p>
              <ol className="text-[10px] text-white/60 space-y-1 list-decimal list-inside">
                <li>Activez votre barre de favoris dans votre navigateur (Ctrl+Shift+B sur Chrome)</li>
                <li><span className="text-white/80">Glissez</span> le bouton ci-dessous vers votre barre de favoris</li>
                <li>Allez sur <span className="text-emerald-400">bet261.mg</span> et trouvez votre match</li>
                <li><span className="text-white/80">Cliquez</span> le bookmarklet dans vos favoris — l'assistant apparaît !</li>
              </ol>
            </div>

            {/* Draggable bookmarklet link */}
            <div className="flex flex-col items-center gap-2 py-3">
              <a
                href={generateBookmarkletUrl()}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gold/20 border border-gold/30 text-gold text-xs font-display font-bold tracking-wider hover:bg-gold/30 transition-colors no-underline cursor-grab active:cursor-grabbing shadow-lg shadow-gold/10"
                draggable="true"
                title="Glissez ce lien vers votre barre de favoris"
                onClick={(e) => e.preventDefault()}
              >
                <Bookmark size={14} />
                VirtuMatch Bet Helper
              </a>
              <p className="text-[9px] text-white/30">
                Glissez ce bouton vers votre barre de favoris
              </p>
            </div>

            {/* Copy fallback */}
            <button
              onClick={handleCopyBookmarklet}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-white/60 font-display text-[10px] tracking-wider"
            >
              {bookmarkletCopied ? (
                <>
                  <Check size={11} className="text-emerald-400" />
                  <span className="text-emerald-400">COPIÉ DANS LE PRESSE-PAPIERS</span>
                </>
              ) : (
                <>
                  <Copy size={11} />
                  OU COPIER LE LIEN DU BOOKMARKLET
                </>
              )}
            </button>
          </div>
        )}

        {/* ─── Section 4: FAQ ────────────────────────────────────────────── */}
        <button
          onClick={() => setActiveSection(activeSection === 'faq' ? null : 'faq')}
          className="w-full mb-4"
        >
          <div className="card-premium p-3 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-fire" />
              <span className="text-xs font-display font-bold text-white/60 tracking-wider">4. QUESTIONS FRÉQUENTES</span>
            </div>
            {activeSection === 'faq' ? <ChevronUp size={14} className="text-white/40" /> : <ChevronDown size={14} className="text-white/40" />}
          </div>
        </button>
        {activeSection === 'faq' && (
          <div className="space-y-1.5 mb-6">
            {faqItems.map((item, i) => (
              <FAQItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        )}

        {/* ─── Contact ───────────────────────────────────────────────────── */}
        <div className="card-premium p-5 mt-2">
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
