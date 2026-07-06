// analyze-match/index.ts — Supabase Edge Function
// AI-powered match analysis — Groq (primary) + Mathematical fallback (no Gemini)
// NO imports — uses Deno.serve() + native fetch
//
// v23: Improved math algorithm v2.0 + AI prompt v6.0
//   - mathPredict v2.0: uses teamStats, form momentum, H2H, virtual football redistribution
//   - Multi-factor confidence (form, H2H, stats, anti-trap)
//   - Anti-trap multicriteria (5 alerts instead of 2)
//   - Virtual football score capping (max 3, redistribute excess)
//   - AI prompt v6.0: multicriteria analysis, typical virtual distribution
// v22: MATH-FIRST + 5s timeout.
//   - TPD early detection: 1 test chunk → if 429 TPD → full math instantly.
//   - 5-second hard deadline: return whatever is ready (partial Groq + math gaps).
//   - No more sequential chunk loops with TPM waits.
//   - mathPredict() returns in <1ms per match — always meets 5s target.

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

if (Deno.env.get("ALLOWED_ORIGIN")) {
  corsHeaders["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  corsHeaders["Vary"] = "Origin";
}

/** Sleep helper */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mask an API key for safe logging */
const maskKey = (key: string) => key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : "NOT_SET";

// ─── SYSTEM PROMPT v6.0 (Groq only) ──────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es FOOTBALL VIRTUEL AI PREDICTOR v6.0. Football virtuel ONLY — pas du vrai football.
Règles virtuel: scores bas (80% sont 0-0,1-0,1-1,2-0,2-1), nul ~30%, avantage domicile ~5%, 3-0+ <8%, JAMAIS 4+.

ANALYSE MULTICRITERE: 1) P(1X2)=(1/cote)/Σ 2) Attaque=BM/MJ, Défense=BE/MJ 3) Momentum forme (V=3,N=1,D=0, poids 1.5→1.0) 4) H2H si dispo 5) Balance buts forme récente (marqués-encaissés) 6) Classement écart 7) Synthèse pondérée 8) Anti-trap multicritère 9) Score.

ANTI-TRAP MULTICRITERE (5 alertes): A)fav cotes mais momentum forme ≤35% B)fav cotes mais attaque<0.9 BM/MJ C)fav cotes mais H2H défavorable (perte>60%) D)classement écarté ≥5 places mais cotes serrées (écart<10%) E)cotes proches.
Compteur: 0→safe, 1-2→moderate, 3+→trap(isAntiTrap=true). Chaque alerte = -0.04 confiance.

SCORE VIRTUEL: home/away entre 0-3 (JAMAIS 4+). Distribution typique: 0-0(18%),1-0(15%),0-1(13%),1-1(14%),2-0(10%),0-2(8%),2-1(9%),1-2(7%).
Règle: Si P(Home)>P(Away): préférer 1-0/2-0/2-1. Si P(Away)>P(Home): 0-1/0-2/1-2. Si P(Draw)>32% ou écart<5%: 0-0/1-1.
Si forme récente montre forte attaque: pencher vers 2-0/2-1 au lieu de 1-0. Si 2 défenses fortes: pencher 0-0/1-0.
Mi-temps≈45% score final.

MARCHÉS: BTTS≤0.65, Over2.5≤0.60 (virtuel=plus de under).

CONFIANCE MULTIFACTEURS: base=prob implicite du favori. +0.05 si forme confirme le favori. +0.03 si H2H confirme. +0.06 si classement confirme. -0.04 par alerte anti-trap. -0.10 si cotes très serrées (écart<5%). -0.08 si piège vrai. Min 0.30, max 0.95. Sans données: ≤0.65 moderate.

RAISONNEMENT: 6-10 phrases FR concises mais denses: prob implicites, profil attaques/défenses équipes, forme+momentum, H2H, score prédit+pourquoi(lier aux données), alertes anti-trap si presentes, confiance avec justifications.

JSON UNIQUEMENT, pas de markdown:
{"predictions":[{"scoreHome":1,"scoreAway":0,"confidence":0.75,"reasoning":"...","isAntiTrap":false,"firstHalfGoal":true,"tendency":"...","dangerLevel":"safe","topScores":[{"score":"1-0","probability":0.25},{"score":"0-0","probability":0.20}],"bttsProb":0.38,"over25Prob":0.35,"firstHalfScore":"1-0","systemHome":"équilibré","systemAway":"défensif","possessionHome":53,"possessionAway":47}]}
RÈGLES: possession=100, topScores somment 0.6-0.85, score prédit=top1, 3-5 scores, system∈offensif|défensif|équilibré.`;

// ─── BUILD USER PROMPT FOR A CHUNK ───────────────────────────────────────────

function buildUserPrompt(matches: any[]): string {
  return matches
    .map((m: any, i: number) => {
      const invH = 1 / m.oddHome, invD = 1 / m.oddDraw, invA = 1 / m.oddAway;
      const tot = invH + invD + invA;
      let b = `M${i + 1}: ${m.home} vs ${m.away} | ${m.oddHome}/${m.oddDraw}/${m.oddAway} | P:${(invH/tot*100).toFixed(0)}/${(invD/tot*100).toFixed(0)}/${(invA/tot*100).toFixed(0)}`;

      if (m.rankingHome) {
        const r = m.rankingHome, mj = r.played || 1;
        b += `\nH:#${r.position} ${mj}j ${r.won}V${r.drawn}N${r.lost}D ${r.goalsFor}-${r.goalsAgainst} ${r.points}p att:${(r.goalsFor/mj).toFixed(1)} def:${(r.goalsAgainst/mj).toFixed(1)}`;
      }
      if (m.rankingAway) {
        const r = m.rankingAway, mj = r.played || 1;
        b += `\nA:#${r.position} ${mj}j ${r.won}V${r.drawn}N${r.lost}D ${r.goalsFor}-${r.goalsAgainst} ${r.points}p att:${(r.goalsFor/mj).toFixed(1)} def:${(r.goalsAgainst/mj).toFixed(1)}`;
      }

      if (m.recentHome?.length > 0) {
        b += `\nFH:${m.recentHome.map((r: any) => `${r.result}${r.scoreHome}-${r.scoreAway}`).join(" ")}`;
      }
      if (m.recentAway?.length > 0) {
        b += `\nFA:${m.recentAway.map((r: any) => `${r.result}${r.scoreHome}-${r.scoreAway}`).join(" ")}`;
      }

      if (m.headToHead?.length > 0) {
        const hw = m.headToHead.filter((h: any) => h.scoreHome > h.scoreAway).length;
        const hd = m.headToHead.filter((h: any) => h.scoreHome === h.scoreAway).length;
        const ha = m.headToHead.filter((h: any) => h.scoreHome < h.scoreAway).length;
        const avg = (m.headToHead.reduce((s: number, h: any) => s + h.scoreHome + h.scoreAway, 0) / m.headToHead.length).toFixed(1);
        b += `\nH2H:${hw}V${hd}N${ha}D avg:${avg}bm`;
      }

      return b;
    })
    .join("\n");
}

// ─── MATHEMATICAL PREDICTION v2.0 (instant fallback) ─────────────
// Uses teamStats, form momentum, H2H, virtual football distribution.
// <1ms per match.

const VIRTUAL_AVG = 1.3;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function poisson(k: number, lambda: number): number {
  if (k === 0) return Math.exp(-lambda);
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonFull(lambda: number, k: number): number {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

function gridSearchLambda(targetPH: number, targetPA: number): { lambdaH: number; lambdaA: number } {
  let bestH = 1.3, bestA = 1.1, bestErr = Infinity;
  for (let lH = 0.5; lH <= 2.8; lH += 0.05) {
    for (let lA = 0.5; lA <= 2.8; lA += 0.05) {
      let pH = 0, pA = 0;
      for (let h = 0; h <= 6; h++) {
        for (let a = 0; a <= 6; a++) {
          const p = poissonFull(lH, h) * poissonFull(lA, a);
          if (h > a) pH += p;
          else if (h < a) pA += p;
        }
      }
      const err = Math.pow(pH - targetPH, 2) + Math.pow(pA - (1 - targetPH - (targetPH > 0.35 ? 0.28 : 0.32)), 2);
      if (err < bestErr) { bestErr = err; bestH = lH; bestA = lA; }
    }
  }
  return { lambdaH: Math.round(bestH * 100) / 100, lambdaA: Math.round(bestA * 100) / 100 };
}

function mathPredict(m: any): any {
  // ── 1. Probabilités implicites ──
  const invH = 1 / m.oddHome, invD = 1 / m.oddDraw, invA = 1 / m.oddAway;
  const invSum = invH + invD + invA;
  const pH = invH / invSum, pD = invD / invSum, pA = invA / invSum;

  let fav: "home" | "away" | "draw";
  if (pH > pD && pH > pA) fav = "home";
  else if (pA > pD && pA > pH) fav = "away";
  else fav = "draw";

  // ── 2. Stats d'équipe ──
  const rH = m.rankingHome, rA = m.rankingAway;
  const mjH = rH?.played || 0, mjA = rA?.played || 0;
  const attH = mjH > 0 ? (rH?.goalsFor || 0) / mjH : VIRTUAL_AVG;
  const defH = mjH > 0 ? (rH?.goalsAgainst || 0) / mjH : VIRTUAL_AVG;
  const attA = mjA > 0 ? (rA?.goalsFor || 0) / mjA : VIRTUAL_AVG;
  const defA = mjA > 0 ? (rA?.goalsAgainst || 0) / mjA : VIRTUAL_AVG;
  const hasStats = mjH >= 3 || mjA >= 3;

  // ── 3. Forme récente avec momentum pondéré ──
  const weights = [1.5, 1.3, 1.2, 1.1, 1.0];
  const pts: Record<string, number> = { V: 3, N: 1, D: 0 };

  function momentum(forms: any[] | undefined): { score: number; wins: number; total: number; avgScored: number; avgConceded: number; balance: number } {
    if (!forms?.length) return { score: 0.5, wins: 0, total: 0, avgScored: VIRTUAL_AVG, avgConceded: VIRTUAL_AVG, balance: 0 };
    let ms = 0, mx = 0, wins = 0, totScored = 0, totConceded = 0;
    const last5 = forms.slice(0, 5);
    last5.forEach((r: any, i: number) => {
      const w = weights[i] || 1.0;
      ms += (pts[r.result] || 0) * w;
      mx += 3 * w;
      if (r.result === "V") wins++;
      totScored += r.scoreHome;
      totConceded += r.scoreAway;
    });
    return {
      score: mx > 0 ? ms / mx : 0.5,
      wins,
      total: last5.length,
      avgScored: last5.length > 0 ? totScored / last5.length : VIRTUAL_AVG,
      avgConceded: last5.length > 0 ? totConceded / last5.length : VIRTUAL_AVG,
      balance: last5.length > 0 ? (totScored - totConceded) / last5.length : 0,
    };
  }

  const momH = momentum(m.recentHome);
  const momA = momentum(m.recentAway);

  // ── 4. H2H ──
  const h2h = m.headToHead || [];
  const h2hTotal = h2h.length;
  const h2hHomeWins = h2h.filter((h: any) => h.scoreHome > h.scoreAway).length;
  const h2hDraws = h2h.filter((h: any) => h.scoreHome === h.scoreAway).length;
  const h2hAwayWins = h2h.filter((h: any) => h.scoreHome < h.scoreAway).length;
  const h2hAvgTotal = h2hTotal > 0 ? (h2h.reduce((s: number, h: any) => s + h.scoreHome + h.scoreAway, 0) / h2hTotal) : 0;
  const h2hBias = h2hTotal >= 2 ? ((h2hHomeWins - h2hAwayWins) / h2hTotal) * 100 : 0; // >0 = home team dominant

  // ── 5. Lambdas de base (grid search depuis cotes) ──
  let { lambdaH, lambdaA } = gridSearchLambda(pH, pA);

  // ── 6. Ajustement lambdas avec stats d'équipe ──
  if (mjH >= 3) {
    const attackStr = attH / VIRTUAL_AVG;
    const defenseWeak = defH / VIRTUAL_AVG;
    lambdaH = lambdaH * 0.70 + lambdaH * attackStr * 0.20 + (lambdaA * defenseWeak) * 0.10;
    lambdaA = lambdaA * 0.95; // slight reduction if opponent has good defense
  }
  if (mjA >= 3) {
    const attackStr = attA / VIRTUAL_AVG;
    const defenseWeak = defA / VIRTUAL_AVG;
    lambdaA = lambdaA * 0.70 + lambdaA * attackStr * 0.20 + (lambdaH * defenseWeak) * 0.10;
    lambdaH = lambdaH * 0.95;
  }

  // ── 7. Ajustement lambdas avec forme ──
  if (momH.total >= 3) {
    lambdaH += (momH.avgScored - VIRTUAL_AVG) * 0.12; // attack boost
    lambdaH -= (momH.avgConceded - VIRTUAL_AVG) * 0.06; // defense penalty
    lambdaH += (momH.score - 0.5) * 0.15; // momentum
    lambdaA += (momH.avgConceded - VIRTUAL_AVG) * 0.04; // opponent benefits from our leaks
  }
  if (momA.total >= 3) {
    lambdaA += (momA.avgScored - VIRTUAL_AVG) * 0.12;
    lambdaA -= (momA.avgConceded - VIRTUAL_AVG) * 0.06;
    lambdaA += (momA.score - 0.5) * 0.15;
    lambdaH += (momA.avgConceded - VIRTUAL_AVG) * 0.04;
  }

  // ── 8. Ajustement H2H ──
  if (h2hTotal >= 2) {
    lambdaH += h2hBias * 0.003;
    lambdaA -= h2hBias * 0.002;
  }

  // Clamp to virtual football range
  lambdaH = clamp(lambdaH, 0.3, 2.8);
  lambdaA = clamp(lambdaA, 0.3, 2.8);

  // ── 9. Matrice de scores avec redistribution virtuelle ──
  interface ScoreEntry { score: string; h: number; a: number; prob: number; outcome: string }
  const matrix: ScoreEntry[] = [];

  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const prob = poissonFull(lambdaH, h) * poissonFull(lambdaA, a);
      const outcome = h > a ? "1" : h < a ? "2" : "X";
      matrix.push({ score: `${h}-${a}`, h, a, prob, outcome });
    }
  }

  // Virtual football redistribution: eliminate 4+, reduce 3-3
  const VIRTUAL_PRIORITY = new Set(["0-0","1-0","0-1","1-1","2-0","0-2","2-1","1-2","2-2","3-0","0-3","3-1","1-3"]);
  const VIRTUAL_BONUS: Record<string, number> = { "0-0":1.15,"1-0":1.12,"0-1":1.10,"1-1":1.12,"2-0":1.08,"0-2":1.05,"2-1":1.06,"1-2":1.04 };

  let excess = 0;
  for (const s of matrix) {
    if (s.h > 3 || s.a > 3) { excess += s.prob; s.prob = 0; }
    else if (s.h === 3 && s.a === 3) { const r = s.prob * 0.70; excess += r; s.prob -= r; }
    else if ((s.h === 3 && s.a >= 2) || (s.a === 3 && s.h >= 2)) { const r = s.prob * 0.40; excess += r; s.prob -= r; }
  }

  if (excess > 0) {
    const realistic = matrix.filter(s => s.prob > 0 && VIRTUAL_PRIORITY.has(s.score));
    const rTotal = realistic.reduce((s, e) => s + e.prob, 0);
    if (rTotal > 0) {
      const wTotal = realistic.reduce((s, e) => s + (e.prob / rTotal) * (VIRTUAL_BONUS[e.score] || 1.0), 0);
      for (const s of matrix) {
        if (s.prob > 0 && VIRTUAL_PRIORITY.has(s.score)) {
          const bonus = VIRTUAL_BONUS[s.score] || 1.0;
          s.prob += excess * (s.prob / rTotal) * bonus / wTotal;
        }
      }
      const newTotal = matrix.reduce((s, e) => s + e.prob, 0);
      for (const s of matrix) s.prob /= newTotal;
    }
  }

  matrix.sort((a, b) => b.prob - a.prob);

  // ── 10. Score principal avec détection piège ──
  const favOutcome = fav === "home" ? "1" : fav === "away" ? "2" : "X";
  let mainScore = matrix[0];
  let isAntiTrap = false;

  if (mainScore.outcome !== favOutcome) {
    const favScores = matrix.filter(s => s.outcome === favOutcome);
    if (favScores.length > 0) { mainScore = favScores[0]; isAntiTrap = true; }
  }

  const scoreH = mainScore.h;
  const scoreA = mainScore.a;

  // ── 11. Anti-trap multicritère (5 alertes) ──
  let trapAlerts = 0;

  // A: fav cotes mais momentum forme ≤ 35%
  const favMom = fav === "home" ? momH : fav === "away" ? momA : { score: 0.5, total: 0 };
  const unfavMom = fav === "home" ? momA : fav === "away" ? momH : { score: 0.5, total: 0 };
  if (favMom.total >= 3 && favMom.score <= 0.35 && unfavMom.total >= 3 && unfavMom.score > 0.55) trapAlerts++;

  // B: fav cotes mais attaque < 0.9
  const favAtt = fav === "home" ? attH : attA;
  if (favAtt < 0.9 && (mjH >= 3 || mjA >= 3)) trapAlerts++;

  // C: fav cotes mais H2H défavorable
  if (h2hTotal >= 2) {
    if (fav === "home" && h2hBias < -30) trapAlerts++;
    if (fav === "away" && h2hBias > 30) trapAlerts++;
  }

  // D: classement écarté ≥ 5 places mais cotes serrées
  if (rH && rA && mjH >= 3 && mjA >= 3) {
    const rankDiff = Math.abs((rH.position || 99) - (rA.position || 99));
    const oddSpread = Math.max(m.oddHome, m.oddAway) - Math.min(m.oddHome, m.oddAway);
    if (rankDiff >= 5 && oddSpread < 0.5) trapAlerts++;
  }

  // E: cotes très proches
  const sortedOdds = [m.oddHome, m.oddDraw, m.oddAway].sort((a: number, b: number) => a - b);
  if (sortedOdds[2] - sortedOdds[0] < 0.5) trapAlerts++;

  if (trapAlerts >= 3) isAntiTrap = true;

  const dangerLevel = trapAlerts === 0 ? "safe" : trapAlerts <= 2 ? "moderate" : "trap";

  // ── 12. Confiance multi-facteurs ──
  const favProb = Math.max(pH, pD, pA);
  let confidence = favProb;

  // Form agreement
  if (momH.total >= 3 && momA.total >= 3) {
    const formAgrees = (fav === "home" && momH.score > momA.score + 0.1) || (fav === "away" && momA.score > momH.score + 0.1);
    confidence += formAgrees ? 0.05 : -0.05;
  }

  // H2H agreement
  if (h2hTotal >= 2) {
    const h2hAgrees = (fav === "home" && h2hBias > 20) || (fav === "away" && h2hBias < -20);
    confidence += h2hAgrees ? 0.03 : -0.03;
  }

  // Ranking agreement
  if (rH && rA && mjH >= 3 && mjA >= 3) {
    const rankAgrees = (fav === "home" && (rA.position || 99) > (rH.position || 0)) ||
                       (fav === "away" && (rH.position || 99) > (rA.position || 0));
    confidence += rankAgrees ? 0.06 : -0.04;
  }

  // Data richness
  const dataRich = Math.min(momH.total, 5) + Math.min(momA.total, 5);
  if (dataRich >= 6) confidence += 0.03;

  // Penalties
  confidence -= trapAlerts * 0.04;
  if (sortedOdds[2] - sortedOdds[0] < 0.5) confidence -= 0.10;
  if (isAntiTrap) confidence -= 0.08;
  if (!hasStats && momH.total === 0) confidence -= 0.10;

  confidence = clamp(confidence, 0.30, 0.95);

  // ── 13. Top scores ──
  const topScores = matrix.slice(0, 5).map(s => ({
    score: s.score,
    probability: Math.round(s.prob * 1000) / 1000
  }));
  // Normalize to 0.6-0.85 range
  const topSum = topScores.reduce((s, e) => s + e.probability, 0);
  const target = clamp(topSum, 0.60, 0.85);
  for (const s of topScores) s.probability = Math.round((s.probability / topSum) * target * 100) / 100;

  // ── 14. Marchés ──
  const bttsProb = clamp(matrix.filter(s => s.h >= 1 && s.a >= 1).reduce((s, e) => s + e.prob, 0), 0.10, 0.65);
  const over25Prob = clamp(matrix.filter(s => s.h + s.a >= 3).reduce((s, e) => s + e.prob, 0), 0.10, 0.60);

  // ── 15. Mi-temps ──
  const mtLH = lambdaH * 0.46, mtLA = lambdaA * 0.46;
  let mtBest = "0-0", mtBestP = 0;
  for (let h = 0; h <= 2; h++) {
    for (let a = 0; a <= 2; a++) {
      const p = poissonFull(mtLH, h) * poissonFull(mtLA, a);
      if (p > mtBestP) { mtBestP = p; mtBest = `${h}-${a}`; }
    }
  }

  // ── 16. Système et possession ──
  function sysStyle(att: number, def: number): string {
    if (att > 1.5) return "offensif";
    if (def < 0.9) return "défensif";
    return "équilibré";
  }
  const systemHome = mjH >= 3 ? sysStyle(attH, defH) : pH > 0.5 ? "offensif" : pH < 0.3 ? "défensif" : "équilibré";
  const systemAway = mjA >= 3 ? sysStyle(attA, defA) : pA > 0.5 ? "offensif" : pA < 0.3 ? "défensif" : "équilibré";

  let possH: number, possA: number;
  if (mjH >= 3 && mjA >= 3) {
    const tA = attH + attA;
    possH = tA > 0 ? Math.round(40 + (attH / tA) * 20) : 50;
  } else {
    possH = Math.round(40 + pH * 25);
  }
  possA = 100 - possH;

  // ── 17. Raisonnement enrichi ──
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const parts: string[] = [];
  parts.push(`Fav: ${fav === "home" ? "1" : fav === "away" ? "2" : "X"} (${pct(favProb)})`);
  parts.push(`λ: ${lambdaH}/${lambdaA}`);
  if (momH.total > 0) parts.push(`Forme ${m.home.substring(0, 8)}: ${m.recentHome!.slice(0, 5).map((r: any) => r.result).join("")} (${pct(momH.score)})`);
  if (momA.total > 0) parts.push(`Forme ${m.away.substring(0, 8)}: ${m.recentAway!.slice(0, 5).map((r: any) => r.result).join("")} (${pct(momA.score)})`);
  if (h2hTotal >= 2) parts.push(`H2H: ${h2hHomeWins}V/${h2hDraws}N/${h2hAwayWins}D`);
  if (mjH >= 3) parts.push(`${m.home.substring(0, 8)}: att${attH.toFixed(1)} def${defH.toFixed(1)}`);
  if (isAntiTrap) parts.push(`PIEGE (${trapAlerts}/5 alertes)`);
  parts.push(`Score: ${scoreH}-${scoreA} (${pct(confidence)})`);

  const tendency = fav === "home" ? "home" : fav === "away" ? "away" : "draw";

  return {
    scoreHome: scoreH,
    scoreAway: scoreA,
    confidence: Math.round(confidence * 100) / 100,
    reasoning: parts.join(" | "),
    isAntiTrap,
    firstHalfGoal: mtBest !== "0-0",
    tendency,
    dangerLevel,
    topScores,
    bttsProb: Math.round(bttsProb * 100) / 100,
    over25Prob: Math.round(over25Prob * 100) / 100,
    firstHalfScore: mtBest,
    systemHome,
    systemAway,
    possessionHome: possH,
    possessionAway: possA,
  };
}

// ─── GROQ PROVIDER (single request, no TPM tracking) ─────────────────────

async function callGroqSingle(apiKey: string, model: string, userPrompt: string): Promise<string | null> {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  console.log(`[analyze-match] 🟢 Groq | Key: ${maskKey(apiKey)} | Model: ${model}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const actualTokens = data.usage?.total_tokens || 0;
      console.log(`[analyze-match] Groq OK (${actualTokens || "?"}tok)`);
      return content;
    }

    const errorBody = await response.text();
    const status = response.status;
    const isTPD = status === 429 && errorBody.includes("tokens per day");
    const isTPM = status === 429 && !isTPD;

    console.log(`[analyze-match] Groq ${status}${isTPD ? " TPD" : isTPM ? " TPM" : ""}: ${errorBody.substring(0, 150)}`);
    return null;
  } catch (err: any) {
    console.log(`[analyze-match] Groq error: ${err.message}`);
    return null;
  }
}

// ─── PARSE AI RESPONSE ────────────────────────────────────────────────────────

function parsePredictions(rawContent: string): any[] {
  if (!rawContent) return [];

  let jsonStr = rawContent;

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key])) return parsed[key];
      }
    }
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  const codeMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) jsonStr = codeMatch[1];
  jsonStr = jsonStr.trim();

  try {
    let predictions = JSON.parse(jsonStr);
    if (!Array.isArray(predictions)) {
      if (predictions && typeof predictions === "object") {
        for (const key of Object.keys(predictions)) {
          if (Array.isArray(predictions[key])) return predictions[key];
        }
      }
      predictions = [predictions];
    }
    return predictions;
  } catch {
    console.error("[analyze-match] Failed to parse response:", jsonStr.substring(0, 200));
    return [];
  }
}

// ─── FAST ANALYSIS: 5-second deadline, single Groq attempt ──────────────────

const DEADLINE_MS = 4500;

interface ChunkResult {
  predictions: any[];
  provider: string;
}

async function analyzeFast(matches: any[], groqKey: string | undefined, groqModel: string): Promise<ChunkResult> {
  const deadline = Date.now() + DEADLINE_MS;

  // If no Groq key → instant math
  if (!groqKey) {
    console.log("[analyze-match] No GROQ_API_KEY → instant math v2.0");
    return { predictions: matches.map(mathPredict), provider: "math-v2" };
  }

  // Single match → try Groq once, fallback to math
  if (matches.length === 1) {
    const prompt = buildUserPrompt(matches);
    const content = await callGroqSingle(groqKey, groqModel, prompt);
    if (content) {
      const preds = parsePredictions(content);
      if (preds.length === 1) {
        console.log("[analyze-match] ✅ Single match via Groq (prompt v6.0)");
        return { predictions: preds, provider: "groq-v6" };
      }
    }
    console.log("[analyze-match] Groq failed for single → math v2.0");
    return { predictions: [mathPredict(matches[0])], provider: "math-v2" };
  }

  // Multiple matches → try ALL in ONE Groq request
  const allPrompt = buildUserPrompt(matches);
  const promptTokens = Math.ceil(allPrompt.length / 3);
  const systemTokens = Math.ceil(SYSTEM_PROMPT.length / 3);
  const totalEstimate = systemTokens + promptTokens + 1000;

  console.log(`[analyze-match] Est. tokens for ${matches.length} matches in 1 request: ~${totalEstimate}`);

  if (totalEstimate > 8000) {
    console.log(`[analyze-match] Too many matches (~${totalEstimate}tok) → instant math v2.0`);
    return { predictions: matches.map(mathPredict), provider: "math-v2" };
  }

  // Try ONE Groq request with deadline
  const timeLeft = deadline - Date.now();
  if (timeLeft <= 0) {
    console.log("[analyze-match] ⏰ Deadline already passed → math v2.0");
    return { predictions: matches.map(mathPredict), provider: "math-v2" };
  }

  const content = await Promise.race([
    callGroqSingle(groqKey, groqModel, allPrompt),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeLeft)),
  ]);

  if (content) {
    const preds = parsePredictions(content);
    if (preds.length >= 1) {
      const allPredictions: any[] = [];
      for (let i = 0; i < matches.length; i++) {
        allPredictions.push(i < preds.length ? preds[i] : mathPredict(matches[i]));
      }
      const mathCount = matches.length - Math.min(preds.length, matches.length);
      const provider = mathCount === 0 ? "groq-v6" : mathCount === matches.length ? "math-v2" : "groq-v6+math-v2";
      console.log(`[analyze-match] ✅ ${provider}: ${preds.length} Groq + ${mathCount} math in ${Date.now() - (deadline - DEADLINE_MS)}ms`);
      return { predictions: allPredictions, provider };
    }
  }

  console.log("[analyze-match] Groq failed/timeout → instant math v2.0");
  return { predictions: matches.map(mathPredict), provider: "math-v2" };
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const startTime = Date.now();

  try {
    const apiKey = req.headers.get("apikey");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "apikey header required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { matches } = await req.json();
    if (!matches || !Array.isArray(matches) || matches.length === 0) {
      return new Response(
        JSON.stringify({ error: "matches array required and non-empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[analyze-match] v23 Processing ${matches.length} match(es)...`);

    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";

    const result = await analyzeFast(matches, GROQ_API_KEY, GROQ_MODEL);

    const elapsed = Date.now() - startTime;
    console.log(`[analyze-match] ✅ Done via ${result.provider}: ${result.predictions.length} predictions in ${elapsed}ms`);

    return new Response(
      JSON.stringify({
        predictions: result.predictions,
        elapsed,
        provider: result.provider,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[analyze-match] Unhandled error:", e.message, e.stack);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});