// analyze-match/index.ts — Supabase Edge Function
// AI-powered match analysis — Multi-provider: Groq (primary) + Google Gemini (fallback)
// NO imports — uses Deno.serve() + native fetch
//
// v20: Ultra-compressed prompt (~35% fewer tokens per run).
//      - SYSTEM_PROMPT: terse notation, minimal JSON template (field list only)
//      - buildUserPrompt: removed momentum/att/def pre-calcs, compact labels
//      - Chunk size 3→4 (fewer chunks = fewer system prompt repetitions)
//      - Shorter output: 3-4 phrase reasoning, 2-3 topScores
// v19: Actual token tracking, TPD detection, lastActualTokensPerChunk cache.
// v18: Compressed system prompt and compact user prompt.
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
// Tracks token usage within the rolling 60s window to avoid 429 on 12k TPM limit

const TPM_LIMIT = 11000; // Stay under 12k with margin
const TPM_WINDOW_MS = 60000; // 60 seconds rolling window

interface TokenRecord {
  tokens: number;
  timestamp: number;
}

const tokenLog: TokenRecord[] = [];

/** Cache actual tokens from last successful Groq call — used for accurate pre-flight estimates */
let lastActualTokensPerChunk = 0;

/** Estimate tokens from text (conservative: 1 token ≈ 3 chars for mixed FR/EN with special chars) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.0);
}

/** Wait until enough TPM budget is available, then record usage */
async function tpmWaitAndRecord(inputTokens: number, estimatedOutputTokens: number): Promise<void> {
  // Use actual tokens from previous call if available (much more accurate than char-based estimate)
  const totalTokens = lastActualTokensPerChunk > 0
    ? lastActualTokensPerChunk
    : Math.ceil((inputTokens + estimatedOutputTokens) * 1.2);
  const now = Date.now();

  // Prune old entries outside the window
  while (tokenLog.length > 0 && now - tokenLog[0].timestamp > TPM_WINDOW_MS) {
    tokenLog.shift();
  }

  // Calculate current usage
  const currentUsage = tokenLog.reduce((sum, entry) => sum + entry.tokens, 0);

  if (currentUsage + totalTokens > TPM_LIMIT) {
    // Wait until oldest entries expire and we have enough budget
    const neededBudget = totalTokens;
    const waitForMs = Math.max(
      5000, // minimum 5s
      tokenLog.length > 0
        ? (tokenLog[0].timestamp + TPM_WINDOW_MS - now) + 1000
        : 15000
    );
    console.log(`[analyze-match] ⏳ TPM budget low (${currentUsage}/${TPM_LIMIT} used, need ${totalTokens} more). Waiting ${waitForMs}ms...`);
    await sleep(waitForMs);

    // Prune again after waiting
    const afterWait = Date.now();
    while (tokenLog.length > 0 && afterWait - tokenLog[0].timestamp > TPM_WINDOW_MS) {
      tokenLog.shift();
    }
  }

  // Record this usage
  tokenLog.push({ tokens: totalTokens, timestamp: Date.now() });

  const newUsage = tokenLog.reduce((sum, entry) => sum + entry.tokens, 0);
  console.log(`[analyze-match] 📊 TPM usage: ~${newUsage}/${TPM_LIMIT}`);
}

// ─── SYSTEM PROMPT (shared by all providers) ────────────────────────────────

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

// ─── GROQ PROVIDER ───────────────────────────────────────────────────────────

async function callGroq(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<{ content: string; provider: string } | null> {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  console.log(`[analyze-match] 🟢 Groq | Key: ${maskKey(apiKey)} | Model: ${model}`);

  // Pre-flight TPM check before any attempt
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

        // Replace estimate with actual tokens in TPM tracker
        if (actualTokens > 0 && tokenLog.length > 0) {
          tokenLog[tokenLog.length - 1].tokens = actualTokens;
          lastActualTokensPerChunk = actualTokens;
          // Re-log with actual count
          const realUsage = tokenLog.reduce((sum, entry) => sum + entry.tokens, 0);
          console.log(`[analyze-match] 📊 TPM actual: ${realUsage}/${TPM_LIMIT} (this chunk: ${actualTokens}tok)`);
        }

        console.log(`[analyze-match] Groq success (${actualTokens || "?"}tok) in ${response.headers.get("x-ratelimit-remaining-requests") || "?"} remaining requests`);
        return { content, provider: "groq" };
      }

      const errorBody = await response.text();
      const status = response.status;

      // 413 = request too large (TPM exceeded) → signal caller to split further
      if (status === 413) {
        console.error(`[analyze-match] Groq 413 (request too large for ${model}): ${errorBody.substring(0, 200)}`);
        // Don't retry 413 — return special marker so caller can split chunks
        return null;
      }

      if (status === 429) {
        const isTPD = errorBody.includes("tokens per day");
        console.error(`[analyze-match] Groq ${isTPD ? "TPD" : "TPM"} 429 (attempt ${attempt + 1}/${maxRetries + 1}): ${errorBody.substring(0, 200)}`);

        // TPD (daily limit) — no point retrying, skip straight to Gemini
        if (isTPD) {
          console.error("[analyze-match] Groq daily limit (TPD) exhausted, skipping retries → Gemini");
          return null;
        }

        if (attempt === maxRetries) {
          console.error("[analyze-match] Groq TPM exhausted, will fallback to Gemini");
          return null;
        }
        // On TPM 429, wait longer to let bucket drain (window is 60s)
        const retryDelay = 15000 + attempt * 10000; // 15s, then 25s
        console.log(`[analyze-match] Groq TPM 429 retry: waiting ${retryDelay}ms for bucket to drain...`);
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

// ─── GOOGLE GEMINI PROVIDER (fallback) ────────────────────────────────────────

async function callGemini(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<{ content: string; provider: string } | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  console.log(`[analyze-match] 🔵 Gemini fallback | Key: ${maskKey(apiKey)} | Model: ${model}`);

  const maxRetries = 1;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[analyze-match] Gemini retry ${attempt}/${maxRetries} after 3000ms...`);
      await sleep(3000);
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        console.log("[analyze-match] Gemini fallback success");
        return { content, provider: "gemini" };
      }

      const errorBody = await response.text();
      const status = response.status;

      if (status === 429) {
        console.error(`[analyze-match] Gemini 429 (attempt ${attempt + 1}/${maxRetries + 1}): ${errorBody.substring(0, 200)}`);
        if (attempt === maxRetries) return null;
        continue;
      }

      // 400 = likely request too large for Gemini too
      if (status === 400) {
        console.error(`[analyze-match] Gemini 400 (request too large?): ${errorBody.substring(0, 200)}`);
        return null;
      }

      console.error(`[analyze-match] Gemini error ${status}: ${errorBody.substring(0, 200)}`);
      return null;
    } catch (err: any) {
      console.error(`[analyze-match] Gemini fetch error: ${err.message}`);
      return null;
    }
  }

  return null;
}

// ─── PARSE AI RESPONSE ────────────────────────────────────────────────────────

function parsePredictions(rawContent: string): any[] {
  if (!rawContent) return [];

  let jsonStr = rawContent;

  // Try direct parse first
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Look for the predictions array inside the object
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key])) {
          return parsed[key];
        }
      }
    }
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not valid JSON yet
  }

  // Extract from code block if present
  const codeMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) jsonStr = codeMatch[1];
  jsonStr = jsonStr.trim();

  try {
    let predictions = JSON.parse(jsonStr);
    if (!Array.isArray(predictions)) {
      // Try to find array inside object
      if (predictions && typeof predictions === "object") {
        for (const key of Object.keys(predictions)) {
          if (Array.isArray(predictions[key])) {
            return predictions[key];
          }
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

// ─── CHUNKED AI CALL: process matches in batches with auto-reduce on 413 ───

interface ChunkResult {
  predictions: any[];
  provider: string;
  chunks: number;
}

async function analyzeChunks(
  matches: any[],
  groqKey: string | undefined,
  groqModel: string,
  geminiKey: string | undefined,
  geminiModel: string,
): Promise<ChunkResult | null> {
  // Start with chunk size from env or default
  let chunkSize = parseInt(Deno.env.get("AI_CHUNK_SIZE") || "4", 10);
  const minChunk = 1;

  while (chunkSize >= minChunk) {
    const chunks: any[][] = [];
    for (let i = 0; i < matches.length; i += chunkSize) {
      chunks.push(matches.slice(i, i + chunkSize));
    }

    console.log(`[analyze-match] Chunking ${matches.length} matches into ${chunks.length} chunk(s) of ${chunkSize} max`);

    const allPredictions: any[] = [];
    let lastProvider = "";
    let failedChunks = 0;
    const errors: string[] = [];

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const userPrompt = buildUserPrompt(chunk);
      let result: { content: string; provider: string } | null = null;

      // Provider 1: Groq
      if (groqKey && !result) {
        result = await callGroq(groqKey, groqModel, SYSTEM_PROMPT, userPrompt);
        if (!result) {
          // Check if it was a 413 (request too large)
          // We detect this by seeing if ALL providers failed for this chunk
          // and the chunk size is > 1 → reduce and retry
          errors.push(`Groq chunk ${ci + 1} failed`);
        }
      }

      // Provider 2: Gemini
      if (!result && geminiKey) {
        console.log(`[analyze-match] Chunk ${ci + 1}/${chunks.length}: falling back to Gemini...`);
        result = await callGemini(geminiKey, geminiModel, SYSTEM_PROMPT, userPrompt);
        if (!result) errors.push(`Gemini chunk ${ci + 1} failed`);
      }

      if (result) {
        const preds = parsePredictions(result.content);
        allPredictions.push(...preds);
        lastProvider = result.provider;
        console.log(`[analyze-match] Chunk ${ci + 1}/${chunks.length}: ${preds.length} predictions via ${result.provider}`);
      } else {
        failedChunks++;
        console.error(`[analyze-match] Chunk ${ci + 1}/${chunks.length}: ALL providers failed`);
      }

      // Delay between chunks — TPM limiter handles Groq, add buffer for Gemini fallback
      if (ci < chunks.length - 1) {
        // Estimate if next chunk will fit in TPM budget
        const nextPrompt = buildUserPrompt(chunks[ci + 1]);
        const nextEstTokens = lastActualTokensPerChunk > 0
          ? lastActualTokensPerChunk
          : estimateTokens(SYSTEM_PROMPT + nextPrompt) + 800;
        const now = Date.now();
        const windowUsage = tokenLog
          .filter(e => now - e.timestamp < TPM_WINDOW_MS)
          .reduce((s, e) => s + e.tokens, 0);

        if (windowUsage + nextEstTokens > TPM_LIMIT) {
          // Need to wait for old entries to expire
          const oldestInWindow = tokenLog.find(e => now - e.timestamp < TPM_WINDOW_MS);
          const waitMs = oldestInWindow
            ? Math.max(10000, (oldestInWindow.timestamp + TPM_WINDOW_MS - now) + 2000)
            : 15000;
          console.log(`[analyze-match] ⏳ Pre-wait before chunk ${ci + 2}: ${waitMs}ms (TPM ~${windowUsage}/${TPM_LIMIT})`);
          await sleep(waitMs);
        } else {
          await sleep(2000); // Minimum 2s between chunks
        }
      }
    }

    if (allPredictions.length > 0) {
      return { predictions: allPredictions, provider: lastProvider, chunks: chunks.length };
    }

    // All chunks failed — if chunkSize > minChunk, try smaller
    if (chunkSize > minChunk && failedChunks === chunks.length) {
      const newSize = Math.max(minChunk, Math.floor(chunkSize / 2));
      console.log(`[analyze-match] All chunks failed at size ${chunkSize}, reducing to ${newSize}...`);
      chunkSize = newSize;
      await sleep(1000);
      continue;
    }

    // Some chunks succeeded, some failed — return what we have
    if (allPredictions.length > 0) {
      return { predictions: allPredictions, provider: lastProvider, chunks: chunks.length };
    }

    break;
  }

  return null;
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const startTime = Date.now();

  try {
    // --- Authorization ---
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

    // --- Provider config ---
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY");
    const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";
    const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";

    if (!GROQ_API_KEY && !GOOGLE_AI_KEY) {
      return new Response(
        JSON.stringify({ error: "No AI provider configured. Set GROQ_API_KEY or GOOGLE_AI_KEY." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Chunked analysis ---
    const result = await analyzeChunks(matches, GROQ_API_KEY, GROQ_MODEL, GOOGLE_AI_KEY, GEMINI_MODEL);

    if (!result || result.predictions.length === 0) {
      console.error("[analyze-match] All AI providers failed for all chunks");
      return new Response(
        JSON.stringify({
          error: "Tous les fournisseurs IA sont indisponibles. L'analyse mathématique sera utilisée.",
          providers: ["Groq failed", "Gemini failed"],
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
