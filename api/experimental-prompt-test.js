// ════════════════════════════════════════════════════════════════════════════
// PHASE 5.3.58.3 — EXPERIMENTAL ENDPOINT: v7.0 vs v8.0 PROMPT COMPARISON
// ════════════════════════════════════════════════════════════════════════════
//
// THIS IS AN EXPERIMENTAL ENDPOINT — NOT PRODUCTION CODE.
// It calls Groq with either v7.0 (production) or v8.0 (relaxed) SYSTEM_PROMPT
// on the same match data and returns the raw response + all hashes for offline
// analysis.
//
// SECURITY:
//   - Uses ADMIN_TOKEN_SECRET (already configured in Vercel) for auth
//   - Does NOT accept Groq API keys from the client
//   - Does NOT expose the GROQ_API_KEY value
//   - Rate-limited to 1 match per call (prevents batch abuse)
//
// USAGE:
//   POST /api/experimental-prompt-test
//   Headers: { x-experimental-token: <ADMIN_TOKEN_SECRET value> }
//   Body: { matches: [{...single match...}], promptVersion: "v7" | "v8" }
//   Response: { promptVersion, contextHash, inputHash, promptHash, responseHash,
//              httpStatus, content, model, tokens, responseTimeMs }
//
// CLEANUP:
//   This file should be REMOVED after the experiment is complete.
//   It is NOT referenced by any production code.
// ════════════════════════════════════════════════════════════════════════════

import { setCorsHeaders } from './_lib/cors.js';
import { requireAuth } from './_lib/auth.js';
import { createRateLimiter } from './_lib/ratelimit.js';
import { getClientIp } from './_lib/request.js';
import {
  buildUserPromptFromMatches,
  buildAIContext,
  buildAISnapshotFromContext,
  computeAIContextHash,
  computeAIInputHash,
  computeAIPromptHash,
} from './_lib/ai-context.js';

// ════════════════════════════════════════════════════════════════════════════
// v7.0 SYSTEM PROMPT — EXACT COPY from api/analyze-match.js L17-47
// DO NOT MODIFY — this must be byte-identical to production for valid comparison
// ════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_V7 = `Tu es ANALYSTE FOOTBALL VIRTUEL v7.0. Football virtuel UNIQUEMENT.

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

// ════════════════════════════════════════════════════════════════════════════
// v8.0 EXPERIMENTAL SYSTEM PROMPT — RELAXED (no shortlist, no 4+ ban)
// ════════════════════════════════════════════════════════════════════════════
//
// CHANGES FROM v7.0:
//   1. REMOVED L21 "REGLES VIRTUEL: scores bas (80%...), JAMAIS 4+"
//      → Replaced with general guidance without banning 4+ or imposing 80% low scores
//   2. REMOVED L28 "SCORE VIRTUEL: 0-3 max... Distribution typique: 0-0(18%)..."
//      → Replaced with "select from the full probability matrix"
//   3. REMOVED L29 "Si P(Home)>P(Away): 1-0/2-0/2-1..." (THE SHORTLIST)
//      → Replaced with "select the most coherent score from the full matrix"
//   4. KEPT: anti-trap, confidence, reasoning, JSON schema, possession, systeme de jeu
//   5. Version bumped: v7.0 → v8.0
// ════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_V8 = `Tu es ANALYSTE FOOTBALL VIRTUEL v8.0. Football virtuel UNIQUEMENT.

PRINCIPE FONDAMENTAL: Aucune prédiction n'est garantie. Tu analyses des probabilités, pas des certitudes. Utilise un langage prudents: "probable", "tend à", "suggère", "envisageable". JAMAIS "garanti", "certain", "sûr", "assuré".

REGLES VIRTUEL: nul~25-30%, avantage domicile~5%. Les scores sont déterminés par l'analyse des probabilités et du contexte, sans restriction arbitraire.

ANALYSE MULTICRITERE: 1) P(1X2)=(1/cote)/Σ 2) Attaque=BM/MJ, Défense=BE/MJ 3) Momentum forme (V=3,N=1,D=0, poids 1.5→1.0) 4) H2H si dispo 5) Balance buts récents 6) Classement écart 7) Synthèse pondérée 8) Anti-trap multicritère 9) Score.

ANTI-TRAP (5 alertes): A)fav cotes mais momentum≤35% B)fav cotes mais attaque<0.9 BM/MJ C)fav cotes mais H2H défavorable (>60%) D)classement écarté≥5 places mais cotes serrées E)cotes proches.
0→safe, 1-2→moderate, 3+→trap(isAntiTrap=true). Chaque alerte=-0.04 confiance.

SCORE VIRTUEL: Analyse la matrice complète des probabilités de scores fournie par le modèle mathématique. Sélectionne le score le plus cohérent avec cette distribution et le contexte du match. Tous les scores de 0-0 à 5-5 sont valides si la probabilité les soutient. Ne sélectionne pas un score parce qu'il appartient à une liste prédéfinie. Ne force pas un résultat nul ou une victoire. Respecte les probabilités produites par le modèle mathématique.
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

// ════════════════════════════════════════════════════════════════════════════
// HASH HELPER (mirror api/_lib/ai-context.js)
// ════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function computeAIResponseHash(content) {
  return sha256('ai_response:' + content);
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════════

const experimentalLimiter = createRateLimiter('experimental-prompt-test', { max: 5, windowMs: 60 * 1000 });

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type, Authorization, x-device-id');
  if (req.method === 'OPTIONS') return res.status(204).end('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Rate limiting: 5 req/60s per IP (stricter than production analyze-match) ──
  const clientIp = getClientIp(req);
  const rateLimit = experimentalLimiter.check(clientIp);
  if (!rateLimit.allowed) {
    return res.status(429).json({ error: 'Too many requests', retryAfter: rateLimit.retryAfter });
  }

  // ── AUTH: use existing requireAuth (HMAC fallback active during migration) ──
  const deviceId = await requireAuth(req);
  if (!deviceId) {
    return res.status(401).json({ error: 'Authentication required (x-device-id header)' });
  }

  // ── PARSE BODY ──────────────────────────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { matches, promptVersion = 'v7' } = body;

  if (!matches || !Array.isArray(matches) || matches.length === 0) {
    return res.status(400).json({ error: 'matches array required' });
  }
  if (matches.length > 1) {
    return res.status(400).json({ error: 'Experimental: max 1 match per call' });
  }

  const systemPrompt = promptVersion === 'v8' ? SYSTEM_PROMPT_V8 : SYSTEM_PROMPT_V7;

  // ── BUILD CONTEXT + USER PROMPT (same for v7 and v8) ────────────────────
  const match = matches[0];
  const ctx = buildAIContext({ ...match, matchIndex: 1 });
  const userPrompt = buildUserPromptFromMatches(matches);
  const snapshot = buildAISnapshotFromContext(ctx);

  // ── COMPUTE HASHES ──────────────────────────────────────────────────────
  const contextHash = computeAIContextHash(ctx);
  const inputHash = computeAIInputHash(snapshot);
  const promptHash = computeAIPromptHash(systemPrompt, userPrompt);

  // ── CALL GROQ (same model/temp/max_tokens as production) ───────────────
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

  if (!GROQ_API_KEY) {
    return res.status(500).json({
      error: 'GROQ_API_KEY not configured',
      contextHash, inputHash, promptHash,
    });
  }

  const requestStart = Date.now();

  try {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      }),
    });

    const responseTimeMs = Date.now() - requestStart;

    if (!groqResponse.ok) {
      return res.status(200).json({
        promptVersion,
        contextHash, inputHash, promptHash,
        httpStatus: groqResponse.status,
        content: null,
        responseHash: null,
        model: GROQ_MODEL,
        tokens: 0,
        responseTimeMs,
        error: `Groq HTTP ${groqResponse.status}`,
      });
    }

    const data = await groqResponse.json();
    const content = data.choices?.[0]?.message?.content || '';
    const responseHash = content ? computeAIResponseHash(content) : null;
    const tokens = data.usage?.total_tokens || 0;

    return res.status(200).json({
      promptVersion,
      contextHash, inputHash, promptHash,
      responseHash,
      httpStatus: 200,
      content,
      model: GROQ_MODEL,
      tokens,
      responseTimeMs,
    });
  } catch (err) {
    return res.status(200).json({
      promptVersion,
      contextHash, inputHash, promptHash,
      httpStatus: 0,
      content: null,
      responseHash: null,
      model: GROQ_MODEL,
      tokens: 0,
      responseTimeMs: Date.now() - requestStart,
      error: err.message,
    });
  }
}
