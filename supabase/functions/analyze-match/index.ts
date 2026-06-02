// analyze-match/index.ts — Supabase Edge Function
// AI-powered match analysis — Multi-provider: Groq (primary) + Google Gemini (fallback)
// NO imports — uses Deno.serve() + native fetch
//
// v14: Switched to Groq as primary AI provider (llama-3.3-70b-versatile)
//      with Google Gemini as automatic fallback.
//      Each provider has its own retry with exponential backoff.

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Sleep helper */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mask an API key for safe logging */
const maskKey = (key: string) => key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : "NOT_SET";

// ─── SYSTEM PROMPT (shared by all providers) ────────────────────────────────

const SYSTEM_PROMPT = `Tu es un expert en prédiction de matchs de football virtuels.
Tu analyses les cotes 1X2 fournies et prédis les résultats avec une logique ANTI-TRAP ÉQUILIBRÉE et MATHÉMATIQUEMENT RIGOUREUSE.

## MÉTHODE D'ANALYSE — Algorithme de Précision

### Étape 1 : Probabilités implicites normalisées
P(résultat) = (1/cote) / Σ(1/cote_i)

### Étape 2 : Analyse du système tactique
À partir des cotes et probabilités, détermine :
- Le SYSTÈME DE JEU probable de chaque équipe (offensif/défensif/équilibré)
- Si une cote dom très basse (<1.40) → système offensif dominant
- Si cotes serrées → systèmes défensifs/prudents
- Si cote nul basse (<3.0) → deux équipes défensives

### Étape 3 : Détection de piège (Anti-Trap)
Si la probabilité du score favori > 15% ET (prob_outsider + prob_nul) > 35% → bascule sur alternative.
Sinon → GARDE LE FAVORI.

### Étape 4 : Score exact basé sur les tendances
- Scores fréquents en virtuel : 1-0, 0-1, 1-1, 2-1, 1-2, 2-0, 0-2, 0-0, 2-2, 3-1, 3-0, 3-2
- Le score DOIT être cohérent avec le système tactique identifié
- Système offensif → plus de buts attendus
- Système défensif → moins de buts, scores serrés

### Étape 5 : Analyse complète des tendances
Pour chaque match, évalue :
- Dynamique offensive/défensive de chaque équipe
- Probabilité de but en 1ère mi-temps
- Probabilité que les deux marquent
- Tendance Over/Under
- Risque de piège

## FORMAT DE RÉPONSE JSON (pour CHAQUE match)
{
  "scoreHome": integer,
  "scoreAway": integer,
  "confidence": number 0-1,
  "reasoning": string (4-5 phrases détaillées: système tactique, piège ou non, dynamique, justification du score),
  "isAntiTrap": boolean,
  "firstHalfGoal": boolean,
  "tendency": string (ex: "Système offensif domicile, défense fragile extérieur — match ouvert"),
  "dangerLevel": "safe" | "moderate" | "trap",
  "topScores": [{"score": "2-1", "probability": 0.18}, ...] (3 scores les plus probables),
  "bttsProb": number 0-1,
  "over25Prob": number 0-1,
  "firstHalfScore": string,
  "systemHome": "offensif" | "défensif" | "équilibré",
  "systemAway": "offensif" | "défensif" | "équilibré",
  "possessionHome": number 40-70 (estimation %),
  "possessionAway": number 30-60 (estimation %)
}

Retourne un tableau JSON. RIEN D'AUTRE que le JSON.`;

// ─── GROQ PROVIDER ───────────────────────────────────────────────────────────

async function callGroq(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<{ content: string; provider: string } | null> {
  const url = "https://api.groq.com/openai/v1/chat/completions";

  console.log(`[analyze-match] 🟢 Groq | Key: ${maskKey(apiKey)} | Model: ${model}`);

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt === 1 ? 3000 : 8000;
      console.log(`[analyze-match] Groq retry ${attempt}/${maxRetries} after ${delay}ms...`);
      await sleep(delay);
    }

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
          temperature: 0.7,
          max_tokens: 8192,
          response_format: { type: "json_object" },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        console.log(`[analyze-match] Groq success in ${response.headers.get("x-ratelimit-remaining-requests") || "?"} remaining requests`);
        return { content, provider: "groq" };
      }

      // Handle errors
      const errorBody = await response.text();
      const status = response.status;

      if (status === 429) {
        console.error(`[analyze-match] Groq 429 (attempt ${attempt + 1}/${maxRetries + 1}): ${errorBody.substring(0, 200)}`);
        if (attempt === maxRetries) {
          console.error("[analyze-match] Groq exhausted, will fallback to Gemini");
          return null; // Signal to try next provider
        }
        continue;
      }

      // Non-429 error from Groq
      console.error(`[analyze-match] Groq error ${status}: ${errorBody.substring(0, 200)}`);
      return null; // Try fallback
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

  const maxRetries = 1; // Only 1 retry for fallback
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = 3000;
      console.log(`[analyze-match] Gemini retry ${attempt}/${maxRetries} after ${delay}ms...`);
      await sleep(delay);
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
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

  // Groq with json_object mode might wrap in an object: {"": [...] or {"matches": [...]}
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Look for the array inside the object
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key])) {
          jsonStr = JSON.stringify(parsed[key]);
          break;
        }
      }
    }
  } catch {
    // Not JSON yet, continue to code block extraction
  }

  // Extract from code block if present
  const codeMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) jsonStr = codeMatch[1];
  jsonStr = jsonStr.trim();

  try {
    let predictions = JSON.parse(jsonStr);
    if (!Array.isArray(predictions)) predictions = [predictions];
    return predictions;
  } catch {
    console.error("[analyze-match] Failed to parse response:", jsonStr.substring(0, 200));
    return [];
  }
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const startTime = Date.now();

  try {
    // --- Authorization: require valid apikey header ---
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

    // --- Build user prompt ---
    const userPrompt = matches
      .map((m: any, i: number) =>
        `Match ${i + 1}: ${m.league ? `[${m.league}] ` : ""}${m.home} vs ${m.away} | Cotes: Dom=${m.oddHome} Nul=${m.oddDraw} Ext=${m.oddAway}`
      )
      .join("\n");

    // --- Provider keys ---
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY");
    const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";
    const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";

    let result: { content: string; provider: string } | null = null;
    const errors: string[] = [];

    // ── Provider 1: Groq (primary) ──
    if (GROQ_API_KEY) {
      result = await callGroq(GROQ_API_KEY, GROQ_MODEL, SYSTEM_PROMPT, userPrompt);
      if (!result) errors.push("Groq failed");
    } else {
      console.log("[analyze-match] GROQ_API_KEY not set, skipping Groq");
      errors.push("GROQ_API_KEY not configured");
    }

    // ── Provider 2: Google Gemini (fallback) ──
    if (!result && GOOGLE_AI_KEY) {
      console.log("[analyze-match] Falling back to Google Gemini...");
      result = await callGemini(GOOGLE_AI_KEY, GEMINI_MODEL, SYSTEM_PROMPT, userPrompt);
      if (!result) errors.push("Gemini failed");
    } else if (!result && !GOOGLE_AI_KEY) {
      console.log("[analyze-match] GOOGLE_AI_KEY not set, no fallback available");
      errors.push("GOOGLE_AI_KEY not configured");
    }

    // ── All providers failed ──
    if (!result) {
      console.error("[analyze-match] All AI providers failed:", errors.join(" | "));
      return new Response(
        JSON.stringify({
          error: "Tous les fournisseurs IA sont indisponibles. L'analyse mathématique sera utilisée.",
          providers: errors,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Parse response ──
    const predictions = parsePredictions(result.content);

    const elapsed = Date.now() - startTime;
    console.log(`[analyze-match] ✅ Success via ${result.provider}: ${predictions.length} prediction(s) in ${elapsed}ms`);

    return new Response(
      JSON.stringify({ predictions, elapsed, provider: result.provider }),
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
