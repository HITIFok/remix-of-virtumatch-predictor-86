// analyze-match/index.ts — Supabase Edge Function
// AI-powered match analysis — Groq (primary) + Mathematical fallback (no Gemini)
// NO imports — uses Deno.serve() + native fetch
//
// v22: MATH-FIRST + 5s timeout.
//   - TPD early detection: 1 test chunk → if 429 TPD → full math instantly.
//   - 5-second hard deadline: return whatever is ready (partial Groq + math gaps).
//   - No more sequential chunk loops with TPM waits.
//   - mathPredict() returns in <1ms per match — always meets 5s target.
// v21: Removed Gemini. When Groq quota exhausted → mathematical algorithm.
// v20: Ultra-compressed prompt (~35% fewer tokens per run).
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

// ─── MATHEMATICAL PREDICTION (instant fallback) ─────────────
// Replicates the v5.0 prompt logic algorithmically. <1ms per match.

function mathPredict(m: any): any {
  const invH = 1 / m.oddHome, invD = 1 / m.oddDraw, invA = 1 / m.oddAway;
  const invSum = invH + invD + invA;
  const pH = invH / invSum, pD = invD / invSum, pA = invA / invSum;

  const rH = m.rankingHome, rA = m.rankingAway;
  const mjH = rH?.played || 1, mjA = rA?.played || 1;
  const attH = (rH?.goalsFor || 0) / mjH;
  const defH = (rH?.goalsAgainst || 0) / mjH;
  const attA = (rA?.goalsFor || 0) / mjA;
  const defA = (rA?.goalsAgainst || 0) / mjA;

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

  const h2h = m.headToHead || [];
  const h2hWins = h2h.filter((h: any) => h.scoreHome > h.scoreAway).length;
  const h2hDraws = h2h.filter((h: any) => h.scoreHome === h.scoreAway).length;
  const h2hLosses = h2h.filter((h: any) => h.scoreHome < h.scoreAway).length;

  let fav = "draw" as string;
  if (pH > pD && pH > pA) fav = "home";
  else if (pA > pD && pA > pH) fav = "away";

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

  if (rH && rA) {
    const rankDiff = Math.abs((rH.position || 99) - (rA.position || 99));
    const oddSpread = Math.max(m.oddHome, m.oddAway) - Math.min(m.oddHome, m.oddAway);
    if (rankDiff >= 5 && oddSpread < 0.5) { trapAlerts++; reasons.push("ranking écarté cotes serrées"); }
  }

  const allOdds = [m.oddHome, m.oddDraw, m.oddAway].sort((a: number, b: number) => a - b);
  if (allOdds[2] - allOdds[0] < 0.5) { trapAlerts++; reasons.push("cotes proches"); }

  const isAntiTrap = trapAlerts >= 3;
  const dangerLevel = trapAlerts === 0 ? "safe" : trapAlerts === 1 ? "safe" : trapAlerts === 2 ? "moderate" : "trap";

  const xgH = (attH + defA) / 2;
  const xgA = (attA + defH) / 2;
  const formAdjH = 1 + (momH.score - 0.5) * 0.8;
  const formAdjA = 1 + (momA.score - 0.5) * 0.8;
  let expH = Math.min(3, Math.min(2.5, Math.pow(xgH * formAdjH, 0.6) * 1.1));
  let expA = Math.min(3, Math.min(2.5, Math.pow(xgA * formAdjA, 0.6) * 1.1));

  let scoreH: number, scoreA: number;

  if (pD > 0.32 || Math.abs(pH - pA) < 0.05) {
    if (expH + expA > 2.0) { scoreH = 1; scoreA = 1; }
    else { scoreH = 0; scoreA = 0; }
  } else if (pH > pA) {
    if (expH > 1.8 && expA < 0.5) { scoreH = 2; scoreA = 0; }
    else if (expH > 1.5) { scoreH = 2; scoreA = 1; }
    else { scoreH = 1; scoreA = 0; }
  } else {
    if (expA > 1.8 && expH < 0.5) { scoreH = 0; scoreA = 2; }
    else if (expA > 1.5) { scoreH = 1; scoreA = 2; }
    else { scoreH = 0; scoreA = 1; }
  }

  if (isAntiTrap) {
    if (scoreH > scoreA) { scoreH = Math.max(0, scoreH - 1); }
    else if (scoreA > scoreH) { scoreA = Math.max(0, scoreA - 1); }
  }

  const mtH = scoreH === 0 ? 0 : (scoreH >= 2 ? 1 : (Math.random() < 0.55 ? 1 : 0));
  const mtA = scoreA === 0 ? 0 : (scoreA >= 2 ? 1 : (Math.random() < 0.55 ? 1 : 0));

  function poisson(k: number, lambda: number): number {
    if (k === 0) return Math.exp(-lambda);
    let p = Math.exp(-lambda);
    for (let i = 1; i <= k; i++) p *= lambda / i;
    return p;
  }

  function scoreProb(sH: number, sA: number): number {
    const lambdaH = Math.max(0.3, expH * 0.7);
    const lambdaA = Math.max(0.3, expA * 0.7);
    const p = poisson(sH, lambdaH) * poisson(sA, lambdaA);
    if (sH === scoreH && sA === scoreA) return p * 2.5;
    if (sH === sA) return p * 1.3;
    return p;
  }

  const candidates: [number, number][] = [
    [scoreH, scoreA],
    [0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [2, 1], [1, 2],
  ];
  const unique = new Map<string, [number, number]>();
  for (const c of candidates) {
    const key = `${c[0]}-${c[1]}`;
    if (!unique.has(key)) unique.set(key, c);
  }

  const scored = [...unique.values()]
    .map(([sH, sA]) => ({ score: `${sH}-${sA}`, probability: scoreProb(sH, sA) }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);

  const rawSum = scored.reduce((s, e) => s + e.probability, 0);
  const target = 0.72;
  for (const s of scored) {
    s.probability = Math.round((s.probability / rawSum) * target * 100) / 100;
  }

  const pBTTS = Math.min(0.65, (expH * expA * 0.35) + 0.15);
  const pOver = Math.min(0.60, (expH + expA > 2.2 ? 0.45 : expH + expA > 1.5 ? 0.30 : 0.18));

  const predictedProb = pH > pA ? pH : pA > pH ? pA : pD;
  let confidence = Math.min(0.92, Math.max(0.50, predictedProb));

  const indicators = [
    fav === "home" && momH.score > 0.55,
    fav === "away" && momA.score > 0.55,
    fav === "home" && attH > 1.3,
    fav === "away" && attA > 1.3,
    h2h.length > 0 && ((fav === "home" && h2hWins > h2hLosses) || (fav === "away" && h2hLosses > h2hWins)),
  ];
  confidence += indicators.filter(Boolean).length * 0.03;
  confidence -= trapAlerts * 0.04;
  confidence = Math.min(0.92, Math.max(0.50, confidence));

  if (!rH && !rA && !m.recentHome?.length && !m.recentAway?.length) {
    confidence = Math.min(confidence, 0.65);
  }

  const tendency = pH > pA ? "home" : pA > pH ? "away" : "draw";

  function systemStyle(att: number, def: number): string {
    if (att > 1.4) return "offensif";
    if (def < 0.8) return "défensif";
    return "équilibré";
  }

  const totalAttDef = (attH + defH + attA + defA) || 2;
  let possH = Math.round(((attH + defA) / totalAttDef) * 100);
  let possA = 100 - possH;

  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  let reasoning = `Probabilités implicites: ${pct(pH)}/${pct(pD)}/${pct(pA)}.`;
  if (momH > 0 || momA > 0) {
    reasoning += ` Forme: ${m.home} ${pct(momH.score)}, ${m.away} ${pct(momA.score)}.`;
  }
  if (attH > 0 || attA > 0) {
    reasoning += ` Attaque/défense: H ${attH.toFixed(1)}/${defH.toFixed(1)}, A ${attA.toFixed(1)}/${defA.toFixed(1)}.`;
  }
  reasoning += ` Score prédit ${scoreH}-${scoreA} (confiance ${pct(confidence)}).`;
  if (isAntiTrap) {
    reasoning += ` ⚠️ ${trapAlerts} alertes anti-trap détectées.`;
  }

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

// ─── GROQ PROVIDER (single request, no TPM tracking) ─────────────────────
// v22: No TPM tracking — send one request, if it fails → math. Simple and fast.

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

const DEADLINE_MS = 4500; // 4.5s budget (leaves 0.5s for response overhead)

interface ChunkResult {
  predictions: any[];
  provider: string;
}

async function analyzeFast(matches: any[], groqKey: string | undefined, groqModel: string): Promise<ChunkResult> {
  const deadline = Date.now() + DEADLINE_MS;

  // If no Groq key → instant math
  if (!groqKey) {
    console.log("[analyze-match] No GROQ_API_KEY → instant math");
    return { predictions: matches.map(mathPredict), provider: "math" };
  }

  // Single match → try Groq once, fallback to math
  if (matches.length === 1) {
    const prompt = buildUserPrompt(matches);
    const content = await callGroqSingle(groqKey, groqModel, prompt);
    if (content) {
      const preds = parsePredictions(content);
      if (preds.length === 1) {
        console.log("[analyze-match] ✅ Single match via Groq");
        return { predictions: preds, provider: "groq" };
      }
    }
    console.log("[analyze-match] Groq failed for single → math");
    return { predictions: [mathPredict(matches[0])], provider: "math" };
  }

  // Multiple matches → try ALL in ONE Groq request (no chunking)
  // If it fits within token limits, great. If not → math for all.
  // This avoids the sequential chunk death spiral.
  const allPrompt = buildUserPrompt(matches);
  const promptTokens = Math.ceil(allPrompt.length / 3);
  const systemTokens = Math.ceil(SYSTEM_PROMPT.length / 3);
  const totalEstimate = systemTokens + promptTokens + 1000; // output buffer

  console.log(`[analyze-match] Est. tokens for ${matches.length} matches in 1 request: ~${totalEstimate}`);

  // If estimate is too large (>8k input), skip Groq entirely → math
  if (totalEstimate > 8000) {
    console.log(`[analyze-match] Too many matches for single request (~${totalEstimate}tok) → instant math`);
    return { predictions: matches.map(mathPredict), provider: "math" };
  }

  // Try ONE Groq request for all matches with deadline
  const groqPromise = callGroqSingle(groqKey, groqModel, allPrompt);

  let content: string | null;
  const timeLeft = deadline - Date.now();
  if (timeLeft <= 0) {
    console.log("[analyze-match] ⏰ Deadline already passed → math");
    return { predictions: matches.map(mathPredict), provider: "math" };
  }

  // Race Groq against deadline
  content = await Promise.race([
    groqPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeLeft)),
  ]);

  if (content) {
    const preds = parsePredictions(content);
    if (preds.length >= 1) {
      // Map predictions back to matches
      const allPredictions: any[] = [];
      for (let i = 0; i < matches.length; i++) {
        if (i < preds.length) {
          allPredictions.push(preds[i]);
        } else {
          allPredictions.push(mathPredict(matches[i]));
        }
      }
      const mathCount = matches.length - Math.min(preds.length, matches.length);
      const provider = mathCount === 0 ? "groq" : mathCount === matches.length ? "math" : "groq+math";
      console.log(`[analyze-match] ✅ ${provider}: ${preds.length} Groq + ${mathCount} math in ${Date.now() - (deadline - DEADLINE_MS)}ms`);
      return { predictions: allPredictions, provider };
    }
  }

  console.log("[analyze-match] Groq failed/timeout → instant math");
  return { predictions: matches.map(mathPredict), provider: "math" };
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
