// ============================================
// AI CONTEXT — CANONICAL SINGLE SOURCE OF TRUTH v1.0
// Phase 5.2 — JavaScript mirror for serverless API
// ============================================
//
// This is the JavaScript equivalent of src/lib/ai-context.ts
// for use in Vercel serverless functions (which run JS, not TS).
//
// ARCHITECTURE:
//   buildAIContext(match)
//        ↓
//       ├── buildUserPromptFromContext(context)   ← text sent to AI
//       └── buildAISnapshotFromContext(context)   ← structured traceability record

import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// BUILD AI CONTEXT (Section 3 — Single Source of Truth)
// ═══════════════════════════════════════════════════════════════════

export function buildAIContext(match) {
  // NOTE: The `source_timestamp` fields below are currently OBSERVATION_TIME
  // (when our scraper observed the data), NOT SOURCE_PROVIDED (when the external
  // provider produced the data). Sporty provides no native timestamps.
  // The timestamp_provenance audit trail distinguishes the two.
  // When Sporty adds native timestamps, update the scraper to set per-source
  // timestamps from the provider response, and provenance will auto-upgrade.
  return {
    home: match.home,
    away: match.away,
    odds: {
      home: match.oddHome,
      draw: match.oddDraw,
      away: match.oddAway,
      source_timestamp: match.oddsTimestamp || null, // Currently = observation time
    },
    standings: {
      home: match.rankingHome || null,
      away: match.rankingAway || null,
      source_timestamp: match.rankingTimestamp || null, // Currently = observation time
    },
    form: {
      home: match.recentHome || null,
      away: match.recentAway || null,
      source_timestamp: match.formTimestamp || null, // Currently = observation time
    },
    h2h: {
      matches: match.headToHead || null,
      source_timestamp: match.h2hTimestamp || null, // Currently = observation time
    },
    match_index: match.matchIndex || 1,
    source_timestamps: {
      odds: match.oddsTimestamp || null,
      ranking: match.rankingTimestamp || null,
      form: match.formTimestamp || null,
      h2h: match.h2hTimestamp || null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// COMPUTE DERIVED CONTEXT (single computation, shared by both)
// ═══════════════════════════════════════════════════════════════════

export function computeAIDerivedContext(ctx) {
  // 1. Implied probabilities
  const invH = 1 / ctx.odds.home;
  const invD = 1 / ctx.odds.draw;
  const invA = 1 / ctx.odds.away;
  const tot = invH + invD + invA;
  const pHome = invH / tot;
  const pDraw = invD / tot;
  const pAway = invA / tot;

  const implied_probabilities = {
    home: pHome,
    draw: pDraw,
    away: pAway,
    home_pct: Math.round(pHome * 100),
    draw_pct: Math.round(pDraw * 100),
    away_pct: Math.round(pAway * 100),
  };

  // 2. Standings formatting
  const formatRanking = (r) => {
    const mj = r.played || 1;
    return '#' + r.position + ' ' + mj + 'j ' + r.won + 'V' + r.drawn + 'N' + r.lost + 'D ' + r.goalsFor + '-' + r.goalsAgainst + ' ' + r.points + 'p att:' + (r.goalsFor / mj).toFixed(1) + ' def:' + (r.goalsAgainst / mj).toFixed(1);
  };

  const standings_formatted = {
    home: ctx.standings.home ? formatRanking(ctx.standings.home) : null,
    away: ctx.standings.away ? formatRanking(ctx.standings.away) : null,
  };

  // 3. Form formatting
  const formatForm = (entries) => {
    return entries.map(r => r.result + r.scoreHome + '-' + r.scoreAway).join(' ');
  };

  const form_formatted = {
    home: ctx.form.home && ctx.form.home.length > 0 ? formatForm(ctx.form.home) : null,
    away: ctx.form.away && ctx.form.away.length > 0 ? formatForm(ctx.form.away) : null,
  };

  // 4. H2H formatting
  let h2h_formatted;
  if (ctx.h2h.matches && ctx.h2h.matches.length > 0) {
    const hw = ctx.h2h.matches.filter(h => h.scoreHome > h.scoreAway).length;
    const hd = ctx.h2h.matches.filter(h => h.scoreHome === h.scoreAway).length;
    const ha = ctx.h2h.matches.filter(h => h.scoreHome < h.scoreAway).length;
    const avgTotal = ctx.h2h.matches.reduce((s, h) => s + h.scoreHome + h.scoreAway, 0) / ctx.h2h.matches.length;
    h2h_formatted = {
      summary: hw + 'V' + hd + 'N' + ha + 'D avg:' + avgTotal.toFixed(1) + 'bm',
      home_wins: hw,
      draws: hd,
      away_wins: ha,
      avg_total_goals: avgTotal,
    };
  } else {
    h2h_formatted = {
      summary: null,
      home_wins: 0,
      draws: 0,
      away_wins: 0,
      avg_total_goals: 0,
    };
  }

  return {
    implied_probabilities,
    standings_formatted,
    form_formatted,
    h2h_formatted,
  };
}

// ═══════════════════════════════════════════════════════════════════
// BUILD USER PROMPT (from canonical context)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the user prompt text sent to the AI model.
 * Derives from AIContext — NOT from independent match processing.
 * Output format EXACTLY matches the original buildUserPrompt() but
 * now uses a single canonical derivation.
 */
export function buildUserPromptFromContext(ctx) {
  const derived = computeAIDerivedContext(ctx);
  const ip = derived.implied_probabilities;

  // Base line: M1: TeamA vs TeamB | 1.85/3.40/4.20 | P:54/29/24
  let b = `M${ctx.match_index}: ${ctx.home} vs ${ctx.away} | ${ctx.odds.home}/${ctx.odds.draw}/${ctx.odds.away} | P:${ip.home_pct}/${ip.draw_pct}/${ip.away_pct}`;

  if (derived.standings_formatted.home) {
    b += '\nH:' + derived.standings_formatted.home;
  }
  if (derived.standings_formatted.away) {
    b += '\nA:' + derived.standings_formatted.away;
  }
  if (derived.form_formatted.home) {
    b += '\nFH:' + derived.form_formatted.home;
  }
  if (derived.form_formatted.away) {
    b += '\nFA:' + derived.form_formatted.away;
  }
  if (derived.h2h_formatted.summary) {
    b += '\nH2H:' + derived.h2h_formatted.summary;
  }

  return b;
}

// ═══════════════════════════════════════════════════════════════════
// BUILD USER PROMPT (array of matches — backward-compatible wrapper)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build user prompt from an array of matches.
 * Each match gets its own AIContext, ensuring the prompt is
 * always derived from the canonical source of truth.
 */
export function buildUserPromptFromMatches(matches) {
  return matches
    .map((m, i) => {
      const ctx = buildAIContext({ ...m, matchIndex: i + 1 });
      return buildUserPromptFromContext(ctx);
    })
    .join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// BUILD AI SNAPSHOT (from canonical context)
// ═══════════════════════════════════════════════════════════════════

function makeInput(name, value, source, sourceTimestamp, version, provenance) {
  return { name, value, source, source_timestamp: sourceTimestamp, version, provenance };
}

/**
 * Build the structured AI inputs for traceability.
 * Derives from AIContext — NOT from independent match processing.
 */
export function buildAISnapshotFromContext(ctx) {
  const derived = computeAIDerivedContext(ctx);
  const ip = derived.implied_probabilities;
  const configVersion = '1.0.0';
  const oddsTs = ctx.odds.source_timestamp;

  const odds = {
    home: makeInput('odds_home', ctx.odds.home, 'bookmaker/scraper', oddsTs, configVersion, 'RECORDED'),
    draw: makeInput('odds_draw', ctx.odds.draw, 'bookmaker/scraper', oddsTs, configVersion, 'RECORDED'),
    away: makeInput('odds_away', ctx.odds.away, 'bookmaker/scraper', oddsTs, configVersion, 'RECORDED'),
    implied_home: makeInput('odds_implied_home', ip.home_pct, 'calculated_from_odds', oddsTs, configVersion, 'RECONSTRUCTED'),
    implied_draw: makeInput('odds_implied_draw', ip.draw_pct, 'calculated_from_odds', oddsTs, configVersion, 'RECONSTRUCTED'),
    implied_away: makeInput('odds_implied_away', ip.away_pct, 'calculated_from_odds', oddsTs, configVersion, 'RECONSTRUCTED'),
  };

  const standings_home = derived.standings_formatted.home
    ? makeInput('standings_home', derived.standings_formatted.home, 'ranking_table', ctx.standings.source_timestamp, configVersion, 'RECORDED')
    : null;

  const standings_away = derived.standings_formatted.away
    ? makeInput('standings_away', derived.standings_formatted.away, 'ranking_table', ctx.standings.source_timestamp, configVersion, 'RECORDED')
    : null;

  const form_home = derived.form_formatted.home
    ? makeInput('form_home', derived.form_formatted.home, 'historical_matches', ctx.form.source_timestamp, configVersion, 'RECORDED')
    : null;

  const form_away = derived.form_formatted.away
    ? makeInput('form_away', derived.form_formatted.away, 'historical_matches', ctx.form.source_timestamp, configVersion, 'RECORDED')
    : null;

  const h2h = derived.h2h_formatted.summary
    ? makeInput('h2h', derived.h2h_formatted.summary, 'historical_matches', ctx.h2h.source_timestamp, configVersion, 'RECORDED')
    : null;

  return { odds, standings_home, standings_away, form_home, form_away, h2h, other: [] };
}

// ═══════════════════════════════════════════════════════════════════
// HASH COMPUTATIONS
// ═══════════════════════════════════════════════════════════════════

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * AI_CONTEXT_HASH — hash of the canonical AIContext (RAW& RAW values)
 */
export function computeAIContextHash(ctx) {
  const canonical = JSON.stringify({
    home: ctx.home,
    away: ctx.away,
    odds_home: ctx.odds.home,
    odds_draw: ctx.odds.draw,
    odds_away: ctx.odds.away,
    standings_home: ctx.standings.home,
    standings_away: ctx.standings.away,
    form_home: ctx.form.home,
    form_away: ctx.form.away,
    h2h: ctx.h2h.matches,
  });
  return sha256('ai_context:' + canonical);
}

/**
 * AI_INPUT_HASH — hash of the derived AIInputs (AFTER transformation)
 */
export function computeAIInputHash(inputs) {
  const parts = [];

  parts.push('odds_home:' + inputs.odds.home.value);
  parts.push('odds_draw:' + inputs.odds.draw.value);
  parts.push('odds_away:' + inputs.odds.away.value);
  parts.push('odds_implicit_h:' + inputs.odds.implied_home.value);
  parts.push('odds_implicit_d:' + inputs.odds.implied_draw.value);
  parts.push('odds_implicit_a:' + inputs.odds.implied_away.value);
  parts.push('odds_ts:' + (inputs.odds.home.source_timestamp || 'null'));

  if (inputs.standings_home) {
    parts.push('standings_h:' + inputs.standings_home.value);
    parts.push('standings_h_ts:' + (inputs.standings_home.source_timestamp || 'null'));
  }
  if (inputs.standings_away) {
    parts.push('standings_a:' + inputs.standings_away.value);
    parts.push('standings_a_ts:' + (inputs.standings_away.source_timestamp || 'null'));
  }
  if (inputs.form_home) {
    parts.push('form_h:' + inputs.form_home.value);
    parts.push('form_h_ts:' + (inputs.form_home.source_timestamp || 'null'));
  }
  if (inputs.form_away) {
    parts.push('form_a:' + inputs.form_away.value);
    parts.push('form_a_ts:' + (inputs.form_away.source_timestamp || 'null'));
  }
  if (inputs.h2h) {
    parts.push('h2h:' + inputs.h2h.value);
    parts.push('h2h_ts:' + (inputs.h2h.source_timestamp || 'null'));
  }
  for (const field of inputs.other) {
    parts.push('other_' + field.name + ':' + field.value);
    parts.push('other_' + field.name + '_ts:' + (field.source_timestamp || 'null'));
  }

  parts.sort();
  return sha256('ai_inputs:' + parts.join('|'));
}

/**
 * AI_PROMPT_HASH
 */
export function computeAIPromptHash(systemPrompt, userPrompt) {
  return sha256('prompt:' + systemPrompt + '|' + userPrompt);
}

/**
 * AI_RESPONSE_HASH
 */
export function computeAIResponseHash(response) {
  return sha256('response:' + response);
}
