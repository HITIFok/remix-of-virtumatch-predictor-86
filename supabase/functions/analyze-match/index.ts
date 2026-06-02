// analyze-match/index.ts — Supabase Edge Function
// AI-powered match analysis using Google Gemini API (direct)
// NO imports — uses Deno.serve() + native fetch
//
// v13: Added Google error body logging on 429, retry with exponential backoff,
//      and detailed error info returned to client for diagnosis.

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Sleep helper */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call Google Gemini API with retry on 429 */
async function callGemini(url: string, body: Record<string, unknown>, maxRetries = 2): Promise<Response> {
  let lastErrorBody = "";
  let lastStatus = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 3s, 8s
      const delay = attempt === 1 ? 3000 : 8000;
      console.log(`[analyze-match] Retry ${attempt}/${maxRetries} after ${delay}ms...`);
      await sleep(delay);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.ok) return response;

    lastStatus = response.status;
    lastErrorBody = await response.text();

    if (response.status === 429) {
      // Check Retry-After header from Google
      const retryAfter = response.headers.get("Retry-After");
      console.error(`[analyze-match] Google 429 (attempt ${attempt + 1}/${maxRetries + 1}) | Retry-After: ${retryAfter || "none"} | Body: ${lastErrorBody}`);

      // If this was the last attempt, break and return the error
      if (attempt === maxRetries) {
        return new Response(
          JSON.stringify({
            error: "Trop de requêtes Google AI. Réessayez dans quelques secondes.",
            googleStatus: 429,
            googleError: lastErrorBody,
            retryAfter: retryAfter,
            attempts: attempt + 1,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Otherwise continue to next retry
      continue;
    }

    // Non-429 error — don't retry, return immediately
    console.error(`[analyze-match] Google API error ${lastStatus}: ${lastErrorBody}`);
    return new Response(
      JSON.stringify({
        error: "Erreur du service Google AI",
        googleStatus: lastStatus,
        googleError: lastErrorBody,
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Should not reach here, but just in case
  return new Response(
    JSON.stringify({ error: "Échec après retries", googleError: lastErrorBody }),
    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

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

    // --- Google AI Key (set in Supabase Edge Function Secrets) ---
    const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY");
    if (!GOOGLE_AI_KEY) {
      console.error("[analyze-match] GOOGLE_AI_KEY is not configured in Edge Function secrets!");
      return new Response(
        JSON.stringify({ error: "GOOGLE_AI_KEY is not configured in Supabase secrets" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_AI_KEY}`;

    // Log key info for debugging (masked)
    const keyPrefix = GOOGLE_AI_KEY.substring(0, 6);
    const keySuffix = GOOGLE_AI_KEY.substring(GOOGLE_AI_KEY.length - 4);
    console.log(`[analyze-match] Using key: ${keyPrefix}...${keySuffix} | Model: ${GEMINI_MODEL}`);

    const systemPrompt = `Tu es un expert en prédiction de matchs de football virtuels.
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

    const userPrompt = matches
      .map((m: any, i: number) =>
        `Match ${i + 1}: ${m.league ? `[${m.league}] ` : ""}${m.home} vs ${m.away} | Cotes: Dom=${m.oddHome} Nul=${m.oddDraw} Ext=${m.oddAway}`
      )
      .join("\n");

    // --- Appel Google Gemini avec retry automatique ---
    const geminiBody: Record<string, unknown> = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    };

    const response = await callGemini(GEMINI_URL, geminiBody);

    // If callGemini returned an error response (429, 502, etc.), propagate it
    if (!response.ok) {
      return response;
    }

    const data = await response.json();

    // Gemini format: data.candidates[0].content.parts[0].text
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];
    jsonStr = jsonStr.trim();

    let predictions;
    try {
      predictions = JSON.parse(jsonStr);
      if (!Array.isArray(predictions)) predictions = [predictions];
    } catch {
      console.error("[analyze-match] Failed to parse Gemini response:", jsonStr.substring(0, 200));
      predictions = [];
    }

    const elapsed = Date.now() - startTime;
    console.log(`[analyze-match] Success: ${predictions.length} prediction(s) in ${elapsed}ms`);

    return new Response(JSON.stringify({ predictions, elapsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[analyze-match] Unhandled error:", e.message, e.stack);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
