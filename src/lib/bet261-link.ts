// ─── bet261.mg Integration Module ──────────────────────────────────────────
// Generates direct links, clipboard data, and bet slip info for bet261.mg.
//
// bet261.mg uses the SAME sporty-tech API as VirtuMatch.
// Routes discovered from Angular app:
//   /sports/event/{eventId}        → Specific match page (with odds + bet slip)
//   /sports/live                   → All live matches
//   /sports                        → All sports
//   /virtual                      → Virtual/instant leagues
//
// Since both apps share the same backend, the match IDs from VirtuMatch
// correspond directly to events on bet261.mg.
//
// LIMITATIONS:
// - bet261.mg is GEOBLOCKED (Madagascar only)
// - No public API for balance, bet placement, or account access
// - We can only open deep links and copy bet info to clipboard
// ─────────────────────────────────────────────────────────────────────────

const BET261_BASE = 'https://bet261.mg';

// ─── Deep Link Generators ────────────────────────────────────────────────

/** Generate a direct link to a specific match on bet261.mg */
export function getBet261MatchLink(matchId: number | string): string {
  return `${BET261_BASE}/sports/event/${matchId}`;
}

/** Generate a link to the virtual/instant leagues section */
export function getBet261VirtualLink(): string {
  return `${BET261_BASE}/virtual`;
}

/** Generate a link to live betting */
export function getBet261LiveLink(): string {
  return `${BET261_BASE}/sports/live`;
}

/** Generate a link to all sports */
export function getBet261SportsLink(): string {
  return `${BET261_BASE}/sports`;
}

// ─── Browser Actions ─────────────────────────────────────────────────────

/** Open bet261.mg in a new tab */
export function openBet261(url: string): void {
  if (typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Open the specific match page on bet261.mg */
export function openBet261Match(matchId: number | string): void {
  openBet261(getBet261MatchLink(matchId));
}

/** Open virtual leagues page */
export function openBet261Virtual(): void {
  openBet261(getBet261VirtualLink());
}

/** Open live betting page */
export function openBet261Live(): void {
  openBet261(getBet261LiveLink());
}

// ─── Bet Slip Data Types ──────────────────────────────────────────────────

export interface BetSlipData {
  matchId: number | string;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  leagueName: string;
  /** Recommended outcome: '1' (home), 'X' (draw), '2' (away) */
  recommendedOutcome: string;
  /** Recommended bet type for score exact */
  betType: string;
  /** Formatted score string */
  scoreText: string;
  /** How early the result was detected (seconds) */
  howEarlySeconds?: number;
  /** Match odds (if available) */
  odds?: { home: number; draw: number; away: number };
  /** Timestamp when data was generated */
  generatedAt: string;
  /** Source URL for reference */
  matchUrl: string;
}

// ─── Bet Slip Data Builder ─────────────────────────────────────────────────

/**
 * Build structured bet slip data from match info.
 * This data can be copied to clipboard or stored for the bookmarklet.
 */
export function buildBetSlipData(params: {
  matchId: number | string;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  leagueName: string;
  howEarlySeconds?: number;
  odds?: { home: number; draw: number; away: number };
}): BetSlipData {
  const { scoreHome, scoreAway } = params;
  const recommendedOutcome = scoreHome > scoreAway ? '1' : scoreHome < scoreAway ? '2' : 'X';
  const scoreText = `${scoreHome} - ${scoreAway}`;

  // Determine best bet type based on score
  let betType = 'Score Exact';
  if (scoreHome === scoreAway) {
    betType = `Score Exact: ${scoreText} (Match Nul)`;
  } else if (scoreHome + scoreAway <= 2) {
    betType = `Score Exact: ${scoreText} (Under 2.5)`;
  } else {
    betType = `Score Exact: ${scoreText} (Over 2.5)`;
  }

  return {
    matchId: params.matchId,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    scoreHome,
    scoreAway,
    leagueName: params.leagueName,
    recommendedOutcome,
    betType,
    scoreText,
    howEarlySeconds: params.howEarlySeconds,
    odds: params.odds,
    generatedAt: new Date().toISOString(),
    matchUrl: getBet261MatchLink(params.matchId),
  };
}

// ─── Clipboard Functions ──────────────────────────────────────────────────

/**
 * Format bet slip data as human-readable text for clipboard.
 * Optimized for quick reading while betting.
 */
export function formatBetSlipText(data: BetSlipData): string {
  const lines = [
    `⚡ VirtuMatch - Resultat Detecte en Avance`,
    ``,
    `Match: ${data.homeTeam} vs ${data.awayTeam}`,
    `Ligue: ${data.leagueName}`,
    `Score: ${data.scoreText}`,
    `Pari recommande: ${data.betType}`,
    `Resultat: ${data.recommendedOutcome === '1' ? data.homeTeam + ' (Victoire Domicile)' : data.recommendedOutcome === '2' ? data.awayTeam + ' (Victoire Exterieur)' : 'Match Nul'}`,
  ];

  if (data.howEarlySeconds !== undefined) {
    const earlyText = data.howEarlySeconds >= 60
      ? `${Math.floor(data.howEarlySeconds / 60)}min ${data.howEarlySeconds % 60}s`
      : `${data.howEarlySeconds}s`;
    lines.push(`Detecte: ${earlyText} avant le coup d'envoi`);
  }

  if (data.odds) {
    lines.push('');
    lines.push(`Cotes: DOM ${data.odds.home} | NUL ${data.odds.draw} | EXT ${data.odds.away}`);
  }

  lines.push('');
  lines.push(`Lien direct: ${data.matchUrl}`);

  return lines.join('\n');
}

/**
 * Copy bet slip text to clipboard.
 * Returns true on success.
 */
export async function copyBetSlipToClipboard(data: BetSlipData): Promise<boolean> {
  try {
    const text = formatBetSlipText(data);
    await navigator.clipboard.writeText(text);

    // Also store in localStorage for the bookmarklet to pick up
    storeBetSlipForBookmarklet(data);

    return true;
  } catch {
    // Fallback for older browsers / HTTP context
    try {
      const textarea = document.createElement('textarea');
      textarea.value = formatBetSlipText(data);
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      storeBetSlipForBookmarklet(data);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Copy & Open bet261.mg in one action.
 * Copies match info to clipboard then opens the match page.
 */
export async function copyAndOpenBet261(data: BetSlipData): Promise<boolean> {
  const copied = await copyBetSlipToClipboard(data);
  if (copied) {
    // Small delay so clipboard write finishes before page switch
    setTimeout(() => {
      openBet261(data.matchUrl);
    }, 200);
  }
  return copied;
}

// ─── Bookmarklet Data Bridge ──────────────────────────────────────────────

const BOOKMARKLET_STORAGE_KEY = 'virtumatch_betslip_data';

/**
 * Store the latest bet slip data in localStorage
 * so the bookmarklet (running on bet261.mg) can read it.
 */
export function storeBetSlipForBookmarklet(data: BetSlipData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BOOKMARKLET_STORAGE_KEY, JSON.stringify(data));
  } catch {
    console.warn('[bet261] Cannot write to localStorage');
  }
}

/**
 * Retrieve stored bet slip data (used by the bookmarklet page).
 */
export function getStoredBetSlipData(): BetSlipData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BOOKMARKLET_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BetSlipData;
  } catch {
    return null;
  }
}

/**
 * Generate the bookmarklet JavaScript URL.
 * The bookmarklet reads bet slip data from localStorage and displays it
 * as an overlay on bet261.mg with betting instructions.
 */
export function generateBookmarkletUrl(): string {
  const js = `javascript:void(function(){try{var d=localStorage.getItem('${BOOKMARKLET_STORAGE_KEY}');if(!d){alert('Aucun pari VirtuMatch en attente.\\nDetectez un resultat en avance d\\'abord!');return;}var s=JSON.parse(d);var o=document.createElement('div');o.id='vm-overlay';o.style.cssText='position:fixed;top:0;right:0;width:380px;max-height:100vh;overflow-y:auto;z-index:99999;background:linear-gradient(135deg,#0a0a0f,#1a0a2e);border-left:2px solid #ff6b35;color:#fff;font-family:system-ui,sans-serif;padding:20px;box-shadow:-5px 0 30px rgba(255,107,53,0.3)';o.innerHTML='<div style=\\'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px\\'><span style=\\'font-size:14px;font-weight:bold;color:#ff6b35\\'>VirtuMatch Bet Helper</span><button onclick=\\'document.getElementById(&quot;vm-overlay&quot;).remove()\\' style=\\'background:none;border:1px solid rgba(255,255,255,0.2);color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer\\'>X</button></div>'+'<div style=\\'background:rgba(0,0,0,0.3);border-radius:8px;padding:12px;margin-bottom:12px\\'><div style=\\'font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px\\'>MATCH</div><div style=\\'font-size:16px;font-weight:bold\\'>'+s.homeTeam+' <span style=\\'color:#ff6b35\\'>'+s.scoreHome+'</span> - <span style=\\'color:#ff6b35\\'>'+s.scoreAway+'</span> '+s.awayTeam+'</div><div style=\\'font-size:11px;color:rgba(255,255,255,0.5);margin-top:4px\\'>'+s.leagueName+'</div></div>'+'<div style=\\'background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.3);border-radius:8px;padding:12px;margin-bottom:12px\\'><div style=\\'font-size:11px;color:#ff6b35;margin-bottom:6px;font-weight:bold\\'>PARI RECOMMANDE</div><div style=\\'font-size:13px\\'>'+s.betType+'</div><div style=\\'font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px\\'>Resultat: '+(s.recommendedOutcome==='1'?s.homeTeam+' gagne':s.recommendedOutcome==='2'?s.awayTeam+' gagne':'Match Nul')+'</div></div>'+'<div style=\\'font-size:11px;color:rgba(255,255,255,0.4);line-height:1.6\\'><strong style=\\'color:#ffd700\\'>Etapes:</strong><br/>1. Trouvez le match ci-dessus<br/>2. Cliquez sur <strong>Score Exact</strong><br/>3. Selectionnez <strong>'+s.scoreText+'</strong><br/>4. Entrez votre mise et pariez!</div>';var existing=document.getElementById('vm-overlay');if(existing)existing.remove();document.body.appendChild(o);}catch(e){alert('Erreur VirtuMatch: '+e.message);}})()`;

  return js;
}

// ─── Notification Integration ─────────────────────────────────────────────

/**
 * Build notification click action URL for bet261.mg.
 * Used in browser notifications to deep-link directly to the match.
 */
export function getNotificationClickUrl(matchId: number | string): string {
  return getBet261MatchLink(matchId);
}
