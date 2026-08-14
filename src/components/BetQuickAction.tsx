import { useState, useCallback } from 'react';
import {
  ExternalLink, Copy, Check, Zap, BookOpen,
  ChevronDown, ChevronUp, Info
} from 'lucide-react';
import {
  buildBetSlipData,
  copyBetSlipToClipboard,
  copyAndOpenBet261,
  openBet261Match,
  generateBookmarkletUrl,
  type BetSlipData,
} from '@/lib/bet261-link';

// ─── Types ─────────────────────────────────────────────────────────────────

interface BetQuickActionProps {
  matchId: number | string;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  leagueName: string;
  howEarlySeconds?: number;
  odds?: { home: number; draw: number; away: number };
  /** Compact mode: just a row with bet button (for alert banner) */
  compact?: boolean;
  /** Show the bookmarklet install button */
  showBookmarklet?: boolean;
}

// ─── Compact Bet Button (for Alert Banner) ────────────────────────────────

export function BetButton({ matchId, homeTeam, awayTeam, scoreHome, scoreAway, leagueName, howEarlySeconds, odds }: BetQuickActionProps) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCopyAndOpen = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    const data = buildBetSlipData({
      matchId, homeTeam, awayTeam, scoreHome, scoreAway, leagueName,
      howEarlySeconds, odds,
    });
    const ok = await copyAndOpenBet261(data);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
    setLoading(false);
  }, [matchId, homeTeam, awayTeam, scoreHome, scoreAway, leagueName, howEarlySeconds, odds]);

  const handleCopyOnly = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const data = buildBetSlipData({
      matchId, homeTeam, awayTeam, scoreHome, scoreAway, leagueName,
      howEarlySeconds, odds,
    });
    const ok = await copyBetSlipToClipboard(data);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  }, [matchId, homeTeam, awayTeam, scoreHome, scoreAway, leagueName, howEarlySeconds, odds]);

  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {/* Copy + Open bet261 */}
      <button
        onClick={handleCopyAndOpen}
        disabled={loading}
        className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/20 border border-emerald-500/30 hover:bg-emerald-500/40 active:scale-95 transition-all"
        title="Copier les infos et ouvrir bet261.mg"
      >
        {copied ? (
          <>
            <Check size={10} className="text-emerald-300" />
            <span className="text-[9px] font-display font-bold text-emerald-300 tracking-wider">COPIÉ</span>
          </>
        ) : (
          <>
            <ExternalLink size={10} className="text-emerald-400" />
            <span className="text-[9px] font-display font-bold text-emerald-400 tracking-wider">PARIER</span>
          </>
        )}
      </button>
      {/* Copy only */}
      <button
        onClick={handleCopyOnly}
        className="flex items-center gap-0.5 px-1.5 py-1 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all"
        title="Copier les infos du match"
      >
        <Copy size={9} className="text-white/40" />
      </button>
    </div>
  );
}

// ─── Full Bet Quick Action Panel ───────────────────────────────────────────

export default function BetQuickAction({
  matchId, homeTeam, awayTeam, scoreHome, scoreAway, leagueName,
  howEarlySeconds, odds, showBookmarklet = false,
}: BetQuickActionProps) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const slipData: BetSlipData = buildBetSlipData({
    matchId, homeTeam, awayTeam, scoreHome, scoreAway, leagueName,
    howEarlySeconds, odds,
  });

  const recommendedOutcome = slipData.recommendedOutcome;
  const outcomeLabel = recommendedOutcome === '1'
    ? `${homeTeam} Victoire`
    : recommendedOutcome === '2'
      ? `${awayTeam} Victoire`
      : 'Match Nul';

  const earlyText = howEarlySeconds !== undefined
    ? (howEarlySeconds >= 60
      ? `${Math.floor(howEarlySeconds / 60)}m ${howEarlySeconds % 60}s`
      : `${howEarlySeconds}s`)
    : null;

  const handleCopyAndOpen = async () => {
    setLoading(true);
    const ok = await copyAndOpenBet261(slipData);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
    setLoading(false);
  };

  const handleCopyOnly = async () => {
    const ok = await copyBetSlipToClipboard(slipData);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleInstallBookmarklet = () => {
    const bookmarkletUrl = generateBookmarkletUrl();
    // Create a temporary anchor to trigger bookmarklet drag
    const link = document.createElement('a');
    link.href = bookmarkletUrl;
    link.className = 'inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gold/20 border border-gold/30 text-gold text-xs font-display font-bold tracking-wider hover:bg-gold/30 transition-colors no-underline';
    link.textContent = ' VirtuMatch Bet Helper';
    link.title = 'Glissez ce lien vers votre barre de favoris';
    link.draggable = true;
    return link;
  };

  return (
    <div className="card-premium border-emerald-500/20 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-gradient-to-r from-emerald-500/10 to-transparent border-b border-emerald-500/10 flex items-center gap-2">
        <Zap size={14} className="text-emerald-400" />
        <span className="text-[11px] font-display font-bold text-emerald-400 tracking-wider">
          PARI RAPIDE SUR BET261
        </span>
        {earlyText && (
          <span className="ml-auto text-[9px] text-fire font-display font-bold">
            {earlyText} en avance
          </span>
        )}
      </div>

      {/* Match Info */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/50 truncate">{leagueName}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-display font-bold text-white/90 truncate">{homeTeam}</span>
              <span className="text-base font-display font-black text-emerald-400">{scoreHome}</span>
              <span className="text-xs text-white/30">-</span>
              <span className="text-base font-display font-black text-emerald-400">{scoreAway}</span>
              <span className="text-sm font-display font-bold text-white/90 truncate">{awayTeam}</span>
            </div>
          </div>
        </div>

        {/* Recommended Bet */}
        <div className="mt-2 px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <p className="text-[10px] text-emerald-400/60 font-display">RECOMMANDATION</p>
          <p className="text-xs font-display font-bold text-emerald-300 mt-0.5">
            {slipData.betType}
          </p>
          <p className="text-[10px] text-white/50 mt-0.5">
            Resultat : {outcomeLabel}
          </p>
        </div>

        {/* Odds display */}
        {odds && (
          <div className="grid grid-cols-3 gap-1 mt-2">
            <div className={`text-center py-1 rounded-md text-[10px] font-display font-bold ${recommendedOutcome === '1' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-white/60'}`}>
              DOM {odds.home}
            </div>
            <div className={`text-center py-1 rounded-md text-[10px] font-display font-bold ${recommendedOutcome === 'X' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-white/60'}`}>
              NUL {odds.draw}
            </div>
            <div className={`text-center py-1 rounded-md text-[10px] font-display font-bold ${recommendedOutcome === '2' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-white/60'}`}>
              EXT {odds.away}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="px-3 pb-3 space-y-1.5">
        {/* Primary: Copy & Open */}
        <button
          onClick={handleCopyAndOpen}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] transition-all text-white font-display font-bold text-xs tracking-wider shadow-lg shadow-emerald-500/20"
        >
          {loading ? (
            <span className="animate-pulse">Copie en cours...</span>
          ) : copied ? (
            <>
              <Check size={14} />
              COPIÉ — bet261 OUVERT
            </>
          ) : (
            <>
              <ExternalLink size={14} />
              COPIER & PARIER MAINTENANT
            </>
          )}
        </button>

        {/* Secondary row */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopyOnly}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-white/70 font-display text-[10px] tracking-wider"
          >
            <Copy size={11} />
            COPIER LES INFOS
          </button>
          <button
            onClick={() => openBet261Match(matchId)}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-white/70 font-display text-[10px] tracking-wider"
          >
            <ExternalLink size={11} />
            OUVRIR BET261
          </button>
        </div>

        {/* Toggle Guide */}
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-white/30 hover:text-white/50 transition-colors"
        >
          <BookOpen size={10} />
          <span className="text-[10px] font-display tracking-wider">
            {showGuide ? 'MASQUER LE GUIDE' : 'COMMENT PARIER RAPIDEMENT'}
          </span>
          {showGuide ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>

        {/* Guide */}
        {showGuide && (
          <div className="px-3 py-2 rounded-lg bg-black/20 border border-white/5 space-y-2">
            <p className="text-[10px] font-display text-gold tracking-wider flex items-center gap-1">
              <Info size={10} /> GUIDE RAPIDE - 4 ETAPES
            </p>
            <ol className="text-[10px] text-white/50 space-y-1.5 list-decimal list-inside">
              <li>
                <span className="text-white/80">Cliquez "COPIER & PARIER"</span> — les infos sont copiées et bet261.mg s'ouvre
              </li>
              <li>
                <span className="text-white/80">Connectez-vous</span> sur bet261.mg si ce n'est pas déjà fait
              </li>
              <li>
                <span className="text-white/80">Trouvez le match</span> {homeTeam} vs {awayTeam}
              </li>
              <li>
                <span className="text-white/80">Cliquez "Score Exact"</span> et sélectionnez <span className="text-emerald-400 font-bold">{scoreHome} - {scoreAway}</span>
              </li>
              <li>
                <span className="text-white/80">Entrez votre mise</span> et validez le pari
              </li>
            </ol>
            <div className="pt-1 border-t border-white/5">
              <p className="text-[9px] text-white/30">
                Le score {scoreHome}-{scoreAway} a été détecté {earlyText || 'en avance'} via l'exploit VirtuMatch.
                Placez votre pari AVANT que le match ne commence pour des cotes maximales.
              </p>
            </div>
          </div>
        )}

        {/* Bookmarklet Install */}
        {showBookmarklet && (
          <div className="px-3 py-2 rounded-lg bg-gold/5 border border-gold/20 space-y-2">
            <p className="text-[10px] font-display text-gold tracking-wider flex items-center gap-1">
              <Zap size={10} /> BOOKMARKLET - ASSISTANT PARI
            </p>
            <p className="text-[10px] text-white/50">
              Glissez ce lien vers votre barre de favoris. Ensuite, sur bet261.mg, cliquez-le pour voir les infos du pari en superposition.
            </p>
            <div className="flex justify-center">
              <a
                href={generateBookmarkletUrl()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gold/20 border border-gold/30 text-gold text-[11px] font-display font-bold tracking-wider hover:bg-gold/30 transition-colors no-underline cursor-grab active:cursor-grabbing"
                draggable="true"
                title="Glissez ce lien vers votre barre de favoris"
                onClick={(e) => e.preventDefault()}
              >
                VirtuMatch Bet Helper
              </a>
            </div>
            <p className="text-[9px] text-white/30 text-center">
              Glissez → Barre de favoris → Cliquez sur bet261.mg
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
