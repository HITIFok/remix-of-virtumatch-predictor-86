// ─── bet261.mg Deep Link Generator ────────────────────────────────────────────
// Generates direct links to bet261.mg for specific matches/events.
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

const BET261_BASE = 'https://bet261.mg';

/**
 * Generate a direct link to a specific match on bet261.mg.
 * Opens the match page with odds ready to bet.
 */
export function getBet261MatchLink(matchId: number | string): string {
  return `${BET261_BASE}/sports/event/${matchId}`;
}

/**
 * Generate a link to the virtual/instant leagues section on bet261.mg.
 */
export function getBet261VirtualLink(): string {
  return `${BET261_BASE}/virtual`;
}

/**
 * Generate a link to live betting on bet261.mg.
 */
export function getBet261LiveLink(): string {
  return `${BET261_BASE}/sports/live`;
}

/**
 * Generate a link to all sports on bet261.mg.
 */
export function getBet261SportsLink(): string {
  return `${BET261_BASE}/sports`;
}

/**
 * Open bet261.mg in a new tab (or mobile browser).
 * @param url - Full URL to open
 */
export function openBet261(url: string): void {
  if (typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Open the specific match page on bet261.mg.
 */
export function openBet261Match(matchId: number | string): void {
  openBet261(getBet261MatchLink(matchId));
}

/**
 * Open the virtual leagues page on bet261.mg.
 */
export function openBet261Virtual(): void {
  openBet261(getBet261VirtualLink());
}

/**
 * Open the live betting page on bet261.mg.
 */
export function openBet261Live(): void {
  openBet261(getBet261LiveLink());
}
