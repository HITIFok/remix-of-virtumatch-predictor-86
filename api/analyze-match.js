// Vercel Serverless Function — analyze-match v24 (ESM)
// AI-powered match analysis — Groq (primary) + Mathematical fallback

import { setCorsHeaders } from './_lib/cors.js';
import { requireAuth, requireUserAuth } from './_lib/auth.js';

const maskKey = (key) => key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : 'NOT_SET';

// ─── SYSTEM PROMPT v7.0 (Groq only) ──────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es ANALYSTE FOOTBALL VIRTUEL v7.0. Football virtuel UNIQUEMENT.

PRINCIPE FONDAMENTAL: Aucune prédiction n'est garantie. Tu analyses des probabilités, pas des certitudes. Utilise un langage prudents: "probable", "tend à", "suggère", "envisageable". JAMAIS "garanti", "certain", "sûr", "assuré".

REGLES VIRTUEL: scores bas (80% sont 0-0,1-0,1-1,2-0,2-1), nul~30%, avantage domicile~5%, 3-0+<8%, JAMAIS 4+.

ANALYSE MULTICRITERE: 1) P(1X2)=(1/cote)/Σ 2) Attaque=BM/MJ, Défense=BE/MJ 3) Momentum forme (V=3,N=1,D=0, poids 1.5→1.0) 4) H2H si dispo 5) Balance buts récents 6) Classement écart 7) Synthèse pondérée 8) Anti-trap multicritère 9) Score.

ANTI-TRAP (5 alertes): A)fav cotes mais momentum≤35% B)fav cotes mais attaque<0.9 BM/MJ C)fav cotes mais H2H défavorable (>60%) D)classement écarté≥5 places mais cotes serrées E)cotes proches.
0→safe, 1-2→moderate, 3+→trap(isAntiTrap=true). Chaque alerte=-0.04 confiance.

SCORE VIRTUEL: 0-3 max par équipe. Distribution typique: 0-0(18%),1-0(15%),0-1(13%),1-1(14%),2-0(10%),0-2(8%),2-1(9%),1-2(7%).
Si P(Home)>P(Away): 1-0/2-0/2-1. Si P(Away)>P(Home): 0-1/0-2/1-2. Si P(Draw)>32% ou écart<5%: 0-0/1-1.
Mi-temps≈45% score final.

MARCHES: BTTS≤0.65, Over2.5≤0.60.

CONFIANCE REALISTE: base=prob implicite favori×0.85 (max 0.68). +0.04 si forme confirme. +0.03 si H2H confirme. +0.04 si IA confirme. -0.05 par alerte anti-trap. -0.10 si cotes serrées. -0.12 si vrai piège. PLAFOND: 0.82. PLANCHER: 0.25.
En virtuel l'incertitude est structurelle → confiance élevée reste modeste.

POSSESSION: basée sur les probabilités 1X2. formule=35+30×P(Home) pour domicile. Toujours refléter l'écart de domination (pas 50/50 si un favori à 78%).

SYSTEME DE JEU: basé sur les buts attendus (lambda). lambda>1.5=offensif, <0.8=défensif, sinon=équilibré.

RAISONNEMENT EDUCATIF (6-10 phrases FR): Explique POURQUOI ce score, pas juste des données.
Structure: 1) Qui est favori et pourquoi (cotes+contexte). 2) Profil offensif/défensif des équipes (avec BM/mj si disponible). 3) Impact de la forme récente (momentum, tendance). 4) H2H si pertinent (qui domine historiquement). 5) Score prédit et justification (lier aux données concrètes). 6) Alertes anti-trap avec explication. 7) Niveau de confiance et ses justifications.
Utilise des phrases complètes et informatives. Ex: "Manchester Blue domine les cotes à 78% grâce à une attaque forte (1.8 BM/mj)" au lieu de "Fav: 1 (78%)".

JSON SANS MARKDOWN:
{"predictions":[{"scoreHome":1,"scoreAway":0,"confidence":0.72,"reasoning":"...","isAntiTrap":false,"firstHalfGoal":true,"tendency":"...","dangerLevel":"safe","topScores":[{"score":"1-0","probability":0.25},{"score":"2-0","probability":0.18},{"score":"0-0","probability":0.15}],"bttsProb":0.38,"over25Prob":0.35,"firstHalfScore":"1-0","systemHome":"offensif","systemAway":"défensif","possessionHome":58,"possessionAway":42}]}
REGLES: possession=100, topScores somment 0.6-0.85, score prédit=top1, 3-5 scores, system∈offensif|défensif|équilibré.`;

// ─── BUILD USER PROMPT ───────────────────────────────────────────────────

function buildUserPrompt(matches) {
  return matches
    .map((m, i) => {
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
        b += `\nFH:${m.recentHome.map((r) => `${r.result}${r.scoreHome}-${r.scoreAway}`).join(' ')}`;
      }
      if (m.recentAway?.length > 0) {
        b += `\nFA:${m.recentAway.map((r) => `${r.result}${r.scoreHome}-${r.scoreAway}`).join(' ')}`;
      }

      if (m.headToHead?.length > 0) {
        const hw = m.headToHead.filter((h) => h.scoreHome > h.scoreAway).length;
        const hd = m.headToHead.filter((h) => h.scoreHome === h.scoreAway).length;
        const ha = m.headToHead.filter((h) => h.scoreHome < h.scoreAway).length;
        const avg = (m.headToHead.reduce((s, h) => s + h.scoreHome + h.scoreAway, 0) / m.headToHead.length).toFixed(1);
        b += `\nH2H:${hw}V${hd}N${ha}D avg:${avg}bm`;
      }

      return b;
    })
    .join('\n');
}

// ─── MATHEMATICAL PREDICTION v2.0 (instant fallback) ─────────────

const VIRTUAL_AVG = 1.3;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function poisson(k, lambda) {
  if (k === 0) return Math.exp(-lambda);
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function factorial(n) {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonFull(lambda, k) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

function gridSearchLambda(targetPH, targetPA) {
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

function mathPredict(m) {
  // ── 1. Probabilités implicites ──
  const invH = 1 / m.oddHome, invD = 1 / m.oddDraw, invA = 1 / m.oddAway;
  const invSum = invH + invD + invA;
  const pH = invH / invSum, pD = invD / invSum, pA = invA / invSum;

  let fav;
  if (pH > pD && pH > pA) fav = 'home';
  else if (pA > pD && pA > pH) fav = 'away';
  else fav = 'draw';

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
  const pts = { V: 3, N: 1, D: 0 };

  function momentum(forms) {
    if (!forms?.length) return { score: 0.5, wins: 0, total: 0, avgScored: VIRTUAL_AVG, avgConceded: VIRTUAL_AVG, balance: 0 };
    let ms = 0, mx = 0, wins = 0, totScored = 0, totConceded = 0;
    const last5 = forms.slice(0, 5);
    last5.forEach((r, i) => {
      const w = weights[i] || 1.0;
      ms += (pts[r.result] || 0) * w;
      mx += 3 * w;
      if (r.result === 'V') wins++;
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
  const h2hHomeWins = h2h.filter((h) => h.scoreHome > h.scoreAway).length;
  const h2hDraws = h2h.filter((h) => h.scoreHome === h.scoreAway).length;
  const h2hAwayWins = h2h.filter((h) => h.scoreHome < h.scoreAway).length;
  const h2hBias = h2hTotal >= 2 ? ((h2hHomeWins - h2hAwayWins) / h2hTotal) * 100 : 0;

  // ── 5. Lambdas de base ──
  let { lambdaH, lambdaA } = gridSearchLambda(pH, pA);

  // ── 6. Ajustement avec stats ──
  if (mjH >= 3) {
    const attackStr = attH / VIRTUAL_AVG;
    const defenseWeak = defH / VIRTUAL_AVG;
    lambdaH = lambdaH * 0.70 + lambdaH * attackStr * 0.20 + (lambdaA * defenseWeak) * 0.10;
    lambdaA = lambdaA * 0.95;
  }
  if (mjA >= 3) {
    const attackStr = attA / VIRTUAL_AVG;
    const defenseWeak = defA / VIRTUAL_AVG;
    lambdaA = lambdaA * 0.70 + lambdaA * attackStr * 0.20 + (lambdaH * defenseWeak) * 0.10;
    lambdaH = lambdaH * 0.95;
  }

  // ── 7. Ajustement avec forme ──
  if (momH.total >= 3) {
    lambdaH += (momH.avgScored - VIRTUAL_AVG) * 0.12;
    lambdaH -= (momH.avgConceded - VIRTUAL_AVG) * 0.06;
    lambdaH += (momH.score - 0.5) * 0.15;
    lambdaA += (momH.avgConceded - VIRTUAL_AVG) * 0.04;
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

  lambdaH = clamp(lambdaH, 0.3, 2.8);
  lambdaA = clamp(lambdaA, 0.3, 2.8);

  // ── 9. Matrice de scores ──
  const matrix = [];
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const prob = poissonFull(lambdaH, h) * poissonFull(lambdaA, a);
      const outcome = h > a ? '1' : h < a ? '2' : 'X';
      matrix.push({ score: `${h}-${a}`, h, a, prob, outcome });
    }
  }

  // Virtual football redistribution
  const VIRTUAL_PRIORITY = new Set(['0-0','1-0','0-1','1-1','2-0','0-2','2-1','1-2','2-2','3-0','0-3','3-1','1-3']);
  const VIRTUAL_BONUS = { '0-0':1.15,'1-0':1.12,'0-1':1.10,'1-1':1.12,'2-0':1.08,'0-2':1.05,'2-1':1.06,'1-2':1.04 };

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

  // ── 10. Score principal ──
  const favOutcome = fav === 'home' ? '1' : fav === 'away' ? '2' : 'X';
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

  const favMom = fav === 'home' ? momH : fav === 'away' ? momA : { score: 0.5, total: 0 };
  const unfavMom = fav === 'home' ? momA : fav === 'away' ? momH : { score: 0.5, total: 0 };
  if (favMom.total >= 3 && favMom.score <= 0.35 && unfavMom.total >= 3 && unfavMom.score > 0.55) trapAlerts++;

  const favAtt = fav === 'home' ? attH : attA;
  if (favAtt < 0.9 && (mjH >= 3 || mjA >= 3)) trapAlerts++;

  if (h2hTotal >= 2) {
    if (fav === 'home' && h2hBias < -30) trapAlerts++;
    if (fav === 'away' && h2hBias > 30) trapAlerts++;
  }

  if (rH && rA && mjH >= 3 && mjA >= 3) {
    const rankDiff = Math.abs((rH.position || 99) - (rA.position || 99));
    const oddSpread = Math.max(m.oddHome, m.oddAway) - Math.min(m.oddHome, m.oddAway);
    if (rankDiff >= 5 && oddSpread < 0.5) trapAlerts++;
  }

  const sortedOdds = [m.oddHome, m.oddDraw, m.oddAway].sort((a, b) => a - b);
  if (sortedOdds[2] - sortedOdds[0] < 0.5) trapAlerts++;

  if (trapAlerts >= 3) isAntiTrap = true;
  const dangerLevel = trapAlerts === 0 ? 'safe' : trapAlerts <= 2 ? 'moderate' : 'trap';

  // ── 12. Confiance multi-facteurs ──
  const favProb = Math.max(pH, pD, pA);
  let confidence = Math.min(favProb * 0.85, 0.68);

  if (momH.total >= 3 && momA.total >= 3) {
    const formAgrees = (fav === 'home' && momH.score > momA.score + 0.1) || (fav === 'away' && momA.score > momH.score + 0.1);
    confidence += formAgrees ? 0.04 : -0.04;
  }
  if (h2hTotal >= 2) {
    const h2hAgrees = (fav === 'home' && h2hBias > 20) || (fav === 'away' && h2hBias < -20);
    confidence += h2hAgrees ? 0.03 : -0.03;
  }
  if (rH && rA && mjH >= 3 && mjA >= 3) {
    const rankAgrees = (fav === 'home' && (rA.position || 99) > (rH.position || 0)) ||
                       (fav === 'away' && (rH.position || 99) > (rA.position || 0));
    confidence += rankAgrees ? 0.04 : -0.03;
  }
  const dataRich = Math.min(momH.total, 5) + Math.min(momA.total, 5);
  if (dataRich >= 6) confidence += 0.02;
  else if (dataRich >= 3) confidence += 0.01;

  confidence -= trapAlerts * 0.05;
  if (sortedOdds[2] - sortedOdds[0] < 0.5) confidence -= 0.10;
  if (isAntiTrap) confidence -= 0.12;
  if (!hasStats && momH.total === 0) confidence -= 0.08;

  confidence = clamp(confidence, 0.25, 0.82);

  // ── 13. Top scores ──
  const topScores = matrix.slice(0, 5).map(s => ({
    score: s.score,
    probability: Math.round(s.prob * 1000) / 1000
  }));
  const topSum = topScores.reduce((s, e) => s + e.probability, 0);
  const target = clamp(topSum, 0.60, 0.85);
  for (const s of topScores) s.probability = Math.round((s.probability / topSum) * target * 100) / 100;

  // ── 14. Marchés ──
  const bttsProb = clamp(matrix.filter(s => s.h >= 1 && s.a >= 1).reduce((s, e) => s + e.prob, 0), 0.10, 0.65);
  const over25Prob = clamp(matrix.filter(s => s.h + s.a >= 3).reduce((s, e) => s + e.prob, 0), 0.10, 0.60);

  // ── 15. Mi-temps ──
  const mtLH = lambdaH * 0.46, mtLA = lambdaA * 0.46;
  let mtBest = '0-0', mtBestP = 0;
  for (let h = 0; h <= 2; h++) {
    for (let a = 0; a <= 2; a++) {
      const p = poissonFull(mtLH, h) * poissonFull(mtLA, a);
      if (p > mtBestP) { mtBestP = p; mtBest = `${h}-${a}`; }
    }
  }

  // ── 16. Système et possession ──
  const systemHome = lambdaH > 1.5 ? 'offensif' : lambdaH < 0.8 ? 'défensif' : 'équilibré';
  const systemAway = lambdaA > 1.5 ? 'offensif' : lambdaA < 0.8 ? 'défensif' : 'équilibré';

  let possH, possA;
  if (mjH >= 3 && mjA >= 3 && attH > 0 && attA > 0) {
    const tA = attH + attA;
    possH = Math.round(35 + (attH / tA) * 30);
  } else {
    possH = Math.round(35 + pH * 30);
  }
  possA = 100 - possH;

  // ── 17. Raisonnement ──
  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  const parts = [];
  const favTeam = fav === 'home' ? m.home : fav === 'away' ? m.away : 'Nul';
  parts.push(`${favTeam} favori (${pct(favProb)})`);
  const totalXG = lambdaH + lambdaA;
  parts.push(totalXG > 2.5 ? `Match ouvert (${totalXG.toFixed(1)} buts attendus)` : `${totalXG.toFixed(1)} buts attendus`);
  if (momH.total >= 3 && momA.total >= 3) {
    parts.push(`Forme: ${m.home} ${pct(momH.score)}, ${m.away} ${pct(momA.score)}`);
  }
  if (isAntiTrap) {
    parts.push(`RISQUE: ${trapAlerts}/5 alertes anti-trap`);
  }
  parts.push(`Score estime ${scoreH}-${scoreA} (confiance ${pct(confidence)})`);

  const tendency = fav === 'home' ? 'home' : fav === 'away' ? 'away' : 'draw';

  return {
    scoreHome: scoreH,
    scoreAway: scoreA,
    confidence: Math.round(confidence * 100) / 100,
    reasoning: parts.join(' | '),
    isAntiTrap,
    firstHalfGoal: mtBest !== '0-0',
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

// ─── GROQ PROVIDER ────────────────────────────────────────────────────────

async function callGroqSingle(apiKey, model, userPrompt) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  console.log(`[analyze-match] Groq | Key: ${maskKey(apiKey)} | Model: ${model}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const actualTokens = data.usage?.total_tokens || 0;
      console.log(`[analyze-match] Groq OK (${actualTokens || '?'}tok)`);
      return content;
    }

    const errorBody = await response.text();
    const status = response.status;
    console.log(`[analyze-match] Groq ${status}: ${errorBody.substring(0, 150)}`);
    return null;
  } catch (err) {
    console.log(`[analyze-match] Groq error: ${err.message}`);
    return null;
  }
}

// ─── PARSE AI RESPONSE ────────────────────────────────────────────────────

function parsePredictions(rawContent) {
  if (!rawContent) return [];

  let jsonStr = rawContent;

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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
      if (predictions && typeof predictions === 'object') {
        for (const key of Object.keys(predictions)) {
          if (Array.isArray(predictions[key])) return predictions[key];
        }
      }
      predictions = [predictions];
    }
    return predictions;
  } catch {
    console.error('[analyze-match] Failed to parse response:', jsonStr.substring(0, 200));
    return [];
  }
}

// ─── FAST ANALYSIS: tight deadline to stay within Vercel 10s limit ─────────
// Vercel Hobby = 10s max. Cold start (1-3s) + auth (0-2s) + processing overhead
// → keep Groq budget conservative to avoid Vercel HTML error page
const DEADLINE_MS = 2500;

async function analyzeFast(matches, groqKey, groqModel, deadlineMs) {
  const deadline = Date.now() + deadlineMs;

  if (!groqKey) {
    console.log('[analyze-match] No GROQ_API_KEY -> instant math v2.0');
    return { predictions: matches.map(mathPredict), provider: 'math-v2' };
  }

  // For 1 match: try Groq directly
  if (matches.length === 1) {
    const prompt = buildUserPrompt(matches);
    const content = await callGroqSingle(groqKey, groqModel, prompt);
    if (content) {
      const preds = parsePredictions(content);
      if (preds.length === 1) {
        console.log('[analyze-match] Single match via Groq');
        return { predictions: preds, provider: 'groq-v6' };
      }
    }
    console.log('[analyze-match] Groq failed for single -> math v2.0');
    return { predictions: [mathPredict(matches[0])], provider: 'math-v2' };
  }

  // For 2+ matches: only try Groq if few matches and small prompt
  // Vercel Hobby 10s is tight — prefer reliable math fallback for batches
  if (matches.length > 3) {
    console.log(`[analyze-match] ${matches.length} matches -> instant math v2.0 (batch reliability)`);
    return { predictions: matches.map(mathPredict), provider: 'math-v2' };
  }

  const allPrompt = buildUserPrompt(matches);
  const promptTokens = Math.ceil(allPrompt.length / 3);
  const systemTokens = Math.ceil(SYSTEM_PROMPT.length / 3);
  const totalEstimate = systemTokens + promptTokens + 1000;

  console.log(`[analyze-match] Est. tokens for ${matches.length} matches: ~${totalEstimate}`);

  if (totalEstimate > 5000) {
    console.log(`[analyze-match] Token estimate too high -> math v2.0`);
    return { predictions: matches.map(mathPredict), provider: 'math-v2' };
  }

  const timeLeft = deadline - Date.now();
  if (timeLeft <= 0) {
    return { predictions: matches.map(mathPredict), provider: 'math-v2' };
  }

  const content = await Promise.race([
    callGroqSingle(groqKey, groqModel, allPrompt),
    new Promise((resolve) => setTimeout(() => resolve(null), timeLeft)),
  ]);

  if (content) {
    const preds = parsePredictions(content);
    if (preds.length >= 1) {
      const allPredictions = [];
      for (let i = 0; i < matches.length; i++) {
        allPredictions.push(i < preds.length ? preds[i] : mathPredict(matches[i]));
      }
      const mathCount = matches.length - Math.min(preds.length, matches.length);
      const provider = mathCount === 0 ? 'groq-v6' : mathCount === matches.length ? 'math-v2' : 'groq-v6+math-v2';
      return { predictions: allPredictions, provider };
    }
  }

  console.log('[analyze-match] Groq failed/timeout -> math v2.0');
  return { predictions: matches.map(mathPredict), provider: 'math-v2' };
}

// ─── AUTH: HMAC device token or legacy fallback ────────────────────────────
// Handled by requireAuth() from _lib/auth.js

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────

const GLOBAL_TIMEOUT_MS = 8000; // Hard limit — must return before Vercel's 10s kill

export default async function handler(req, res) {
  // CORS (shared module — no wildcard)
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type, Authorization, x-device-id');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Global timeout: ensures we ALWAYS return JSON, never Vercel HTML ──
  const globalDeadline = Date.now() + GLOBAL_TIMEOUT_MS;
  let responded = false;
  const guard = (fn) => async (...args) => {
    if (responded) return;
    if (Date.now() > globalDeadline) {
      if (!responded) { responded = true; res.status(504).json({ error: 'Server timeout — try fewer matches' }); }
      return;
    }
    try { return await fn(...args); }
    catch (e) {
      if (!responded) {
        responded = true;
        console.error('[analyze-match] Error:', e.message, e.stack);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };

  return guard(async () => {
    // ── Auth gate: user session (Bearer) or HMAC device token (legacy) ──
    const userId = await requireUserAuth(req);
    let deviceId;
    if (userId) {
      deviceId = userId; // Bearer token — user auth takes priority, no DB call needed
    } else {
      deviceId = await requireAuth(req);
    }
    if (!deviceId) {
      return res.status(401).json({ error: 'Authentication required (Device token or x-device-id header)' });
    }

    const startTime = Date.now();

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const matches = body.matches;

    if (!matches || !Array.isArray(matches) || matches.length === 0) {
      return res.status(400).json({ error: 'matches array required and non-empty' });
    }

    // Limit: max 50 matches per request
    // (>3 matches use instant math fallback anyway — no Groq cost)
    if (matches.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 matches per request' });
    }

    // Limit: max 100KB body size
    const bodyStr = JSON.stringify(body);
    if (bodyStr.length > 102400) {
      return res.status(413).json({ error: 'Request body too large' });
    }

    console.log(`[analyze-match] v24 Processing ${matches.length} match(es) for device ${deviceId}...`);

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    // Adjust deadline based on remaining time
    const remainingMs = globalDeadline - Date.now() - 1000; // 1s buffer for response
    const effectiveDeadline = Math.max(1000, Math.min(DEADLINE_MS, remainingMs));
    const result = await analyzeFast(matches, GROQ_API_KEY, GROQ_MODEL, effectiveDeadline);

    const elapsed = Date.now() - startTime;
    console.log(`[analyze-match] Done via ${result.provider}: ${result.predictions.length} predictions in ${elapsed}ms`);

    return res.status(200).json({
      predictions: result.predictions,
      elapsed,
      provider: result.provider,
    });
  })();
};
