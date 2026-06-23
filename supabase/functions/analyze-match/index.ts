// analyze-match/index.ts — Supabase Edge Function
// AI-powered match analysis — Groq (primary) + Mathematical fallback (no Gemini)
// NO imports — uses Deno.serve() + native fetch
//
// v21: Removed Gemini. When Groq quota exhausted → mathematical algorithm (same v5.0 rules).
//      mathPredict() replicates the AI prompt logic: implicit probabilities, form momentum,
//      anti-trap detection, virtual score rules, BTTS/Over2.5 caps.
// v20: Ultra-compressed prompt (~35% fewer tokens per run).
// v19: Actual token tracking, TPD detection, lastActualTokensPerChunk cache.
// v16: Improved prompt v5.0 — virtual football specific constraints.

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

// ─── TPM RATE LIMITER ─────────────────────────────────────────────────────

const TPM_LIMIT = 11000;
const TPM_WINDOW_MS = 60000;

interface TokenRecord {
  tokens: number;
  timestamp: number;
}

const tokenLog: TokenRecord[] = [];
let lastActualTokensPerChunk = 0;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.0);
}

async function tpmWaitAndRecord(inputTokens: number, estimatedOutputTokens: number): Promise<void> {
  const totalTokens = lastActualTokensPerChunk > 0
    ? lastActualTokensPerChunk
    : Math.ceil((inputTokens + estimatedOutputTokens) * 1.2);
  const now = Date.now();

  while (tokenLog.length > 0 && now - tokenLog[0].timestamp > TPM_WINDOW_MS) {
    tokenLog.shift();
  }

  const currentUsage = tokenLog.reduce((sum, entry) => sum + entry.tokens, 0);

  if (currentUsage + totalTokens > TPM_LIMIT) {
    const waitForMs = Math.max(
      5000,
      tokenLog.length > 0
        ? (tokenLog[0].timestamp + TPM_WINDOW_MS - now) + 1000
        : 15000
    );
    console.log(`[analyze-match] ⏳ TPM budget low (${currentUsage}/${TPM_LIMIT} used, need ${totalTokens} more). Waiting ${waitForMs}ms...`);
    await sleep(waitForMs);

    const afterWait = Date.now();
    while (tokenLog.length > 0 && afterWait - tokenLog[0].timestamp > TPM_WINDOW_MS) {
      tokenLog.shift();
    }
  }

  tokenLog.push({ tokens: totalTokens, timestamp: Date.now() });
  const newUsage = tokenLog.reduce((sum, entry) => sum + entry.tokens, 0);
  console.log(`[analyze-match] 📊 TPM usage: ~${newUsage}/${TPM_LIMIT}`);
}

// ─── SYSTEM PROMPT (Groq only) ────────────────────────────────────────────

const SYSTEM_PROMPT = `Rôle:VIRTUFoot PREDICTOR v5. Virtuel ONLY.
Règles: scores bas(0-0,1-0,1-1,2-0,2-1≈80%), nul≈30%, dom+5%, 3-0+<8%.
Analyse: P(1X2)=inv/Σ|att=BM/MJ|def=BE/MJ|forme(V3N1D0,w→1.5)|H2H|anti-trap|score.
Anti-trap: fav cotes mais(≤1V/5formes|att<1.2|H2H défav|ranking écarté cotes serrées|cotes proches). 0-1→safe|2→moderate|3+→trap.
Score: 0-3max. P(H)>P(A)→1-0/2-0/2-1|P(A)>P(H)→0-1/0-2/1-2|P(D)>32%|écart<5%→0-0/1-1|MT≈45%final.
BTTS≤0.65|Over2.5≤0.60|conf=baseP+0.03/confirm-0.04/alerte[0.50-0.92]|sans données≤0.65.
Raisonnement: 3-4 phrases FR.
JSON sans markdown. Champs par prediction: scoreHome,scoreAway,confidence,reasoning,isAntiTrap,firstHalfGoal,tendency,dangerLevel,topScores[{score,probability}],bttsProb,over25Prob,firstHalfScore,systemHome,systemAway,possessionHome,possessionAway.
Règles: poss=100|topScores Σ=0.6-0.85|prédit=top1|2-3 scores|system∈off|def|éq.`;

// ─── BUILD USER PROMPT FOR A CHUNK ───────────────────────────────────────────

function buildUserPrompt(matches: any[]): string {
  return matches
    .map((m: any, i: number) => {
      const invH = 1 / m.oddHome, invD = 1 / m.oddDraw, invA = 1 / m.oddAway;
      const tot = invH + invD + invA;
      let b = `M${i + 1}: ${m.home} vs ${m.away} | ${m.oddHome}/${m.oddDraw}/${m.oddAway} | P:${(invH/tot*100).toFixed(0)}/${(invD/tot*100).toFixed(0)}/${(invA/tot*100).toFixed(0)}`;

      if (m.rankingHome) {
        const r = m.rankingHome, mj = r.played || 1;
        b += `\nH:#${r.position} ${mj}j ${r.won}V${r.drawn}N${r.lost}D ${r.goalsFor}-${r.goalsAgainst} ${r.points}p`;
      }
      if (m.rankingAway) {
        const r = m.rankingAway, mj = r.played || 1;
        b += `\nA:#${r.position} ${mj}j ${r.won}V${r.drawn}N${r.lost}D ${r.goalsFor}-${r.goalsAgainst} ${r.points}p`;
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
        b += `\nH2H:${hw}V${hd}N${ha}D g${avg}`;
      }

      return b;
    })
    .join("\n");
}

// ─── MATHEMATICAL PREDICTION (fallback when Groq unavailable) ─────────────
// Replicates the v5.0 prompt logic algorithmically.

function mathPredict(m: any): any {
  // --- Implicit probabilities ---
  const invH = 1 / m.oddHome, invD = 1 / m.oddDraw, invA = 1 / m.oddAway;
  const invSum = invH + invD + invA;
  const pH = invH / invSum, pD = invD / invSum, pA = invA / invSum;

  // --- Stats from rankings ---
  const rH = m.rankingHome, rA = m.rankingAway;
  const mjH = rH?.played || 1, mjA = rA?.played || 1;
  const attH = (rH?.goalsFor || 0) / mjH;
  const defH = (rH?.goalsAgainst || 0) / mjH;
  const attA = (rA?.goalsFor || 0) / mjA;
  const defA = (rA?.goalsAgainst || 0) / mjA;

  // --- Form momentum (V=3, N=1, D=0, weights 1.5→1.0) ---
  const weights = [1.5, 1.3, 1.2, 1.1, 1.0];
  const pts: Record<string, number> = { V: 3, N: 1, D: 0 };

  function momentum(forms: any[] | undefined): { score: number; wins: number; total: number } {
    if (!forms?.length) return { score: 0, wins: 0, total: 0 };
    let ms = 0, mx = 0, wins = 0;
    const last5 = forms.slice(0, 5);
    last5.forEach((r: any, i: number) => {
      const w = weights[i] || 1.0;
      ms += (pts[r.result] || 0) * w;
      mx += 3 * w;
      if (r.result === "V") wins++;
    });
    return { score: mx > 0 ? ms / mx : 0, wins, total: last5.length };
  }

  const momH = momentum(m.recentHome);
  const momA = momentum(m.recentAway);

  // --- H2H ---
  const h2h = m.headToHead || [];
  const h2hWins = h2h.filter((h: any) => h.scoreHome > h.scoreAway).length;
  const h2hDraws = h2h.filter((h: any) => h.scoreHome === h.scoreAway).length;
  const h2hLosses = h2h.filter((h: any) => h.scoreHome < h.scoreAway).length;
  const h2hAvgGoals = h2h.length > 0
    ? h2h.reduce((s: number, h: any) => s + h.scoreHome + h.scoreAway, 0) / h2h.length
    : 0;

  // --- Determine favorite by odds ---
  let fav = "draw" as string;
  if (pH > pD && pH > pA) fav = "home";
  else if (pA > pD && pA > pH) fav = "away";

  // --- Anti-trap detection ---
  let trapAlerts = 0;
  const reasons: string[] = [];

  if (fav === "home") {
    if (momH.total >= 3 && momH.wins <= 1) { trapAlerts++; reasons.push("fav cotes ≤1V/5 formes"); }
    if (attH < 1.2) { trapAlerts++; reasons.push("fav cotes att<1.2"); }
    if (h2h.length > 0 && h2hLosses > h2hWins) { trapAlerts++; reasons.push("fav cotes H2H défav"); }
  } else if (fav === "away") {
    if (momA.total >= 3 && momA.wins <= 1) { trapAlerts++; reasons.push("fav cotes ≤1V/5 formes"); }
    if (attA < 1.2) { trapAlerts++; reasons.push("fav cotes att<1.2"); }
    if (h2h.length > 0 && h2hWins > h2hLosses) { trapAlerts++; reasons.push("fav cotes H2H défav"); }
  }

  // Ranking far apart but odds close
  if (rH && rA) {
    const rankDiff = Math.abs((rH.position || 99) - (rA.position || 99));
    const oddSpread = Math.max(m.oddHome, m.oddAway) - Math.min(m.oddHome, m.oddAway);
    if (rankDiff >= 5 && oddSpread < 0.5) { trapAlerts++; reasons.push("ranking écarté cotes serrées"); }
  }

  // Odds very close (all within 0.5)
  const allOdds = [m.oddHome, m.oddDraw, m.oddAway].sort((a: number, b: number) => a - b);
  if (allOdds[2] - allOdds[0] < 0.5) { trapAlerts++; reasons.push("cotes proches"); }

  const isAntiTrap = trapAlerts >= 3;
  const dangerLevel = trapAlerts === 0 ? "safe" : trapAlerts === 1 ? "safe" : trapAlerts === 2 ? "moderate" : "trap";

  // --- Score prediction (virtual football rules) ---
  // Expected goals based on attack/defense
  const xgH = (attH + defA) / 2;
  const xgA = (attA + defH) / 2;

  // Adjust by form momentum (+10% per 0.1 above 0.5, -10% per 0.1 below 0.5)
  const formAdjH = 1 + (momH.score - 0.5) * 0.8;
  const formAdjA = 1 + (momA.score - 0.5) * 0.8;

  let expH = xgH * formAdjH;
  let expA = xgA * formAdjA;

  // Apply virtual football constraints: scores are low
  // 80% are 0-0, 1-0, 1-1, 2-0, 2-1
  // Apply a compression function to pull scores toward 0-1 range
  expH = Math.min(2.5, Math.pow(expH, 0.6) * 1.1);
  expA = Math.min(2.5, Math.pow(expA, 0.6) * 1.1);

  // Cap at 3
  expH = Math.min(3, expH);
  expA = Math.min(3, expA);

  let scoreH: number, scoreA: number;

  // Determine score based on probability (same rules as prompt)
  if (pD > 0.32 || Math.abs(pH - pA) < 0.05) {
    // Draw likely
    if (expH + expA > 2.0) { scoreH = 1; scoreA = 1; }
    else { scoreH = 0; scoreA = 0; }
  } else if (pH > pA) {
    // Home favored
    if (expH > 1.8 && expA < 0.5) { scoreH = 2; scoreA = 0; }
    else if (expH > 1.5) { scoreH = 2; scoreA = 1; }
    else { scoreH = 1; scoreA = 0; }
  } else {
    // Away favored
    if (expA > 1.8 && expH < 0.5) { scoreH = 0; scoreA = 2; }
    else if (expA > 1.5) { scoreH = 1; scoreA = 2; }
    else { scoreH = 0; scoreA = 1; }
  }

  // Anti-trap adjustment: if trap detected, move score one step toward draw
  if (isAntiTrap) {
    if (scoreH > scoreA) { scoreH = Math.max(0, scoreH - 1); }
    else if (scoreA > scoreH) { scoreA = Math.max(0, scoreA - 1); }
  }

  // --- Half-time score (≈45% of final) ---
  const mtH = scoreH === 0 ? 0 : (scoreH >= 2 ? 1 : (Math.random() < 0.55 ? 1 : 0));
  const mtA = scoreA === 0 ? 0 : (scoreA >= 2 ? 1 : (Math.random() < 0.55 ? 1 : 0));

  // --- Top scores ---
  function scoreProb(sH: number, sA: number): number {
    // Poisson-like probability centered on expected goals
    const lambdaH = Math.max(0.3, expH * 0.7);
    const lambdaA = Math.max(0.3, expA * 0.7);
    const p = poisson(sH, lambdaH) * poisson(sA, lambdaA);
    // Boost if this is the predicted score
    if (sH === scoreH && sA === scoreA) return p * 2.5;
    // Slight boost for draw-like scores in virtual football
    if (sH === sA) return p * 1.3;
    return p;
  }

  const candidates: [number, number][] = [
    [scoreH, scoreA],
    [0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [2, 1], [1, 2],
  ];
  // Remove duplicates, keep unique
  const unique = new Map<string, [number, number]>();
  for (const c of candidates) {
    const key = `${c[0]}-${c[1]}`;
    if (!unique.has(key)) unique.set(key, c);
  }

  const scored = [...unique.values()]
    .map(([sH, sA]) => ({ score: `${sH}-${sA}`, probability: scoreProb(sH, sA) }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);

  // Normalize probabilities to sum 0.6-0.85
  const rawSum = scored.reduce((s, e) => s + e.probability, 0);
  const target = 0.72;
  for (const s of scored) {
    s.probability = Math.round((s.probability / rawSum) * target * 100) / 100;
  }

  // --- BTTS & Over 2.5 ---
  const pBTTS = Math.min(0.65, (expH * expA * 0.35) + 0.15);
  const pOver = Math.min(0.60, (expH + expA > 2.2 ? 0.45 : expH + expA > 1.5 ? 0.30 : 0.18));

  // --- Confidence ---
  const predictedProb = pH > pA ? pH : pA > pH ? pA : pD;
  let confidence = Math.min(0.92, Math.max(0.50, predictedProb));

  // +0.03 per confirming indicator
  const indicators = [
    fav === "home" && momH.score > 0.55,
    fav === "away" && momA.score > 0.55,
    fav === "home" && attH > 1.3,
    fav === "away" && attA > 1.3,
    h2h.length > 0 && ((fav === "home" && h2hWins > h2hLosses) || (fav === "away" && h2hLosses > h2hWins)),
  ];
  confidence += indicators.filter(Boolean).length * 0.03;

  // -0.04 per trap alert
  confidence -= trapAlerts * 0.04;
  confidence = Math.min(0.92, Math.max(0.50, confidence));

  // No data cap
  if (!rH && !rA && !m.recentHome?.length && !m.recentAway?.length) {
    confidence = Math.min(confidence, 0.65);
  }

  // --- Tendency ---
  const tendency = pH > pA ? "home" : pA > pH ? "away" : "draw";

  // --- System style ---
  function systemStyle(att: number, def: number): string {
    if (att > 1.4) return "offensif";
    if (def < 0.8) return "défensif";
    return "équilibré";
  }

  // --- Possession (attack + defense balance) ---
  const totalAttDef = (attH + defH + attA + defA) || 2;
  let possH = Math.round(((attH + defA) / totalAttDef) * 100);
  let possA = 100 - possH;

  // --- Reasoning ---
  const reasoning = buildReasoning(m, {
    pH, pD, pA, attH, defH, attA, defA,
    momH: momH.score, momA: momA.score,
    scoreH, scoreA, trapAlerts, confidence, isAntiTrap,
  });

  return {
    scoreHome: scoreH,
    scoreAway: scoreA,
    confidence: Math.round(confidence * 100) / 100,
    reasoning,
    isAntiTrap,
    firstHalfGoal: mtH > 0 || mtA > 0,
    tendency,
    dangerLevel,
    topScores: scored,
    bttsProb: Math.round(pBTTS * 100) / 100,
    over25Prob: Math.round(pOver * 100) / 100,
    firstHalfScore: `${mtH}-${mtA}`,
    systemHome: systemStyle(attH, defH),
    systemAway: systemStyle(attA, defA),
    possessionHome: possH,
    possessionAway: possA,
  };
}

/** Poisson probability P(X=k) for lambda */
function poisson(k: number, lambda: number): number {
  if (k === 0) return Math.exp(-lambda);
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

/** Build a short reasoning string (3-4 sentences) */
function buildReasoning(m: any, d: {
  pH: number; pD: number; pA: number;
  attH: number; defH: number; attA: number; defA: number;
  momH: number; momA: number;
  scoreH: number; scoreA: number;
  trapAlerts: number; confidence: number; isAntiTrap: boolean;
}): string {
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  let r = `Probabilités implicites: ${pct(d.pH)}/${pct(d.pD)}/${pct(d.pA)}.`;

  if (d.momH > 0 || d.momA > 0) {
    r += ` Forme: ${m.home} ${pct(d.momH)}, ${m.away} ${pct(d.momA)}.`;
  }
  if (d.attH > 0 || d.attA > 0) {
    r += ` Attaque/défense: H ${d.attH.toFixed(1)}/${d.defH.toFixed(1)}, A ${d.attA.toFixed(1)}/${d.defA.toFixed(1)}.`;
  }

  r += ` Score prédit ${d.scoreH}-${d.scoreA} (confiance ${pct(d.confidence)}).`;

  if (d.isAntiTrap) {
    r += ` ⚠️ ${d.trapAlerts} alertes anti-trap détectées.`;
  }

  return r;
}

// ─── GROQ PROVIDER ───────────────────────────────────────────────────────────

async function callGroq(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<{ content: string; provider: string } | null> {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  console.log(`[analyze-match] 🟢 Groq | Key: ${maskKey(apiKey)} | Model: ${model}`);

  await tpmWaitAndRecord(estimateTokens(systemPrompt + userPrompt), 800);

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 3072,
          response_format: { type: "json_object" },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        const actualTokens = data.usage?.total_tokens || 0;

        if (actualTokens > 0 && tokenLog.length > 0) {
          tokenLog[tokenLog.length - 1].tokens = actualTokens;
          lastActualTokensPerChunk = actualTokens;
          const realUsage = tokenLog.reduce((sum, entry) => sum + entry.tokens, 0);
          console.log(`[analyze-match] 📊 TPM actual: ${realUsage}/${TPM_LIMIT} (this chunk: ${actualTokens}tok)`);
        }

        console.log(`[analyze-match] Groq success (${actualTokens || "?"}tok) in ${response.headers.get("x-ratelimit-remaining-requests") || "?"} remaining requests`);
        return { content, provider: "groq" };
      }

      const errorBody = await response.text();
      const status = response.status;

      if (status === 413) {
        console.error(`[analyze-match] Groq 413 (request too large for ${model}): ${errorBody.substring(0, 200)}`);
        return null;
      }

      if (status === 429) {
        const isTPD = errorBody.includes("tokens per day");
        console.error(`[analyze-match] Groq ${isTPD ? "TPD" : "TPM"} 429 (attempt ${attempt + 1}/${maxRetries + 1}): ${errorBody.substring(0, 200)}`);

        if (isTPD) {
          console.log("[analyze-match] Groq daily limit (TPD) exhausted → mathematical fallback");
          return null;
        }

        if (attempt === maxRetries) {
          console.log("[analyze-match] Groq TPM exhausted → mathematical fallback");
          return null;
        }
        const retryDelay = 15000 + attempt * 10000;
        console.log(`[analyze-match] Groq TPM 429 retry: waiting ${retryDelay}ms...`);
        await sleep(retryDelay);
        continue;
      }

      console.error(`[analyze-match] Groq error ${status}: ${errorBody.substring(0, 200)}`);
      return null;
    } catch (err: any) {
      console.error(`[analyze-match] Groq fetch error (attempt ${attempt + 1}): ${err.message}`);
      if (attempt === maxRetries) return null;
    }
  }

  return null;
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

// ─── CHUNKED ANALYSIS: Groq with mathematical fallback ─────────────────────

interface ChunkResult {
  predictions: any[];
  provider: string;
  chunks: number;
}

async function analyzeChunks(
  matches: any[],
  groqKey: string | undefined,
  groqModel: string,
): Promise<ChunkResult> {
  let chunkSize = parseInt(Deno.env.get("AI_CHUNK_SIZE") || "4", 10);
  const minChunk = 1;

  // Track which matches still need predictions after Groq
  const pendingMatches: { match: any; originalIndex: number }[] = matches.map((m, i) => ({ match: m, originalIndex: i }));
  const groqPredictions: (any | null)[] = new Array(matches.length).fill(null);
  let groqChunksUsed = 0;

  // --- Try Groq first ---
  if (groqKey) {
    while (chunkSize >= minChunk) {
      const chunks: any[][] = [];
      for (let i = 0; i < pendingMatches.length; i += chunkSize) {
        chunks.push(pendingMatches.slice(i, i + chunkSize).map(p => p.match));
      }

      console.log(`[analyze-match] Groq: chunking ${pendingMatches.length} matches into ${chunks.length} chunk(s) of ${chunkSize} max`);
      let allFailed = true;

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const userPrompt = buildUserPrompt(chunk);
        const result = await callGroq(groqKey, groqModel, SYSTEM_PROMPT, userPrompt);

        if (result) {
          const preds = parsePredictions(result.content);
          // Store predictions at their original indices
          const startIdx = ci * chunkSize;
          for (let pi = 0; pi < preds.length && startIdx + pi < pendingMatches.length; pi++) {
            const origIdx = pendingMatches[startIdx + pi].originalIndex;
            groqPredictions[origIdx] = preds[pi];
          }
          allFailed = false;
          groqChunksUsed++;
          console.log(`[analyze-match] Groq chunk ${ci + 1}/${chunks.length}: ${preds.length} predictions`);
        } else {
          console.log(`[analyze-match] Groq chunk ${ci + 1}/${chunks.length}: failed → will use math fallback`);
        }

        // Delay between chunks
        if (ci < chunks.length - 1) {
          const nextPrompt = buildUserPrompt(chunks[ci + 1]);
          const nextEstTokens = lastActualTokensPerChunk > 0
            ? lastActualTokensPerChunk
            : estimateTokens(SYSTEM_PROMPT + nextPrompt) + 800;
          const now = Date.now();
          const windowUsage = tokenLog
            .filter(e => now - e.timestamp < TPM_WINDOW_MS)
            .reduce((s, e) => s + e.tokens, 0);

          if (windowUsage + nextEstTokens > TPM_LIMIT) {
            const oldestInWindow = tokenLog.find(e => now - e.timestamp < TPM_WINDOW_MS);
            const waitMs = oldestInWindow
              ? Math.max(10000, (oldestInWindow.timestamp + TPM_WINDOW_MS - now) + 2000)
              : 15000;
            console.log(`[analyze-match] ⏳ Pre-wait before chunk ${ci + 2}: ${waitMs}ms (TPM ~${windowUsage}/${TPM_LIMIT})`);
            await sleep(waitMs);
          } else {
            await sleep(2000);
          }
        }
      }

      if (!allFailed) break;

      // All chunks failed — try smaller chunk size
      if (chunkSize > minChunk) {
        const newSize = Math.max(minChunk, Math.floor(chunkSize / 2));
        console.log(`[analyze-match] All Groq chunks failed at size ${chunkSize}, reducing to ${newSize}...`);
        chunkSize = newSize;
        await sleep(1000);
        continue;
      }

      break;
    }
  }

  // --- Fill gaps with mathematical predictions ---
  const allPredictions: any[] = [];
  let mathCount = 0;

  for (let i = 0; i < matches.length; i++) {
    if (groqPredictions[i]) {
      allPredictions.push(groqPredictions[i]);
    } else {
      const mathPred = mathPredict(matches[i]);
      allPredictions.push(mathPred);
      mathCount++;
    }
  }

  if (mathCount > 0) {
    console.log(`[analyze-match] 🧮 Mathematical fallback for ${mathCount} match(es)`);
  }

  const provider = mathCount === matches.length ? "math" : mathCount > 0 ? "groq+math" : "groq";
  return { predictions: allPredictions, provider, chunks: groqChunksUsed || 0 };
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

    console.log(`[analyze-match] Processing ${matches.length} match(es)...`);

    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";

    if (!GROQ_API_KEY) {
      console.log("[analyze-match] No GROQ_API_KEY → full mathematical fallback");
    }

    // --- Chunked analysis with mathematical fallback ---
    const result = await analyzeChunks(matches, GROQ_API_KEY, GROQ_MODEL);

    const elapsed = Date.now() - startTime;
    console.log(`[analyze-match] ✅ Success via ${result.provider}: ${result.predictions.length} prediction(s) in ${elapsed}ms (${result.chunks} chunk(s))`);

    return new Response(
      JSON.stringify({
        predictions: result.predictions,
        elapsed,
        provider: result.provider,
        chunks: result.chunks,
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