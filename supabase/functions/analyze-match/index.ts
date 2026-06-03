// analyze-match/index.ts — Supabase Edge Function
// AI-powered match analysis — Multi-provider: Groq (primary) + Google Gemini (fallback)
// NO imports — uses Deno.serve() + native fetch
//
// v15: Added intelligent chunking to stay within Groq TPM limits.
//      Matches are split into chunks of CHUNK_SIZE (default 3).
//      If 413 (request too large), automatically retry with smaller chunks.
//      Results are merged across all chunks.

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

// ─── SYSTEM PROMPT (shared by all providers) ────────────────────────────────

const SYSTEM_PROMPT = `Tu es un analyste quantitatif spécialisé dans les matchs de football virtuels.

Ton objectif est d'estimer le résultat le plus probable en utilisant une combinaison de statistiques, probabilités implicites, forme récente, classement, performances offensives/défensives, confrontations directes et détection de pièges bookmakers.

Tu ne dois JAMAIS suivre aveuglément les cotes.

Tu dois identifier les situations où le marché surestime ou sous-estime une équipe.

---

# DONNÉES DISPONIBLES

Pour chaque rencontre, tu reçois :

## 1. Cotes 1X2
* Victoire domicile
* Match nul
* Victoire extérieur

## 2. Classement
* Position, Points, Buts marqués, Buts encaissés, Différence de buts

## 3. Forme récente
5 derniers matchs : Victoire (V), Nul (N), Défaite (D) avec scores.

## 4. Historique H2H
Confrontations directes entre les deux équipes.

---

# ALGORITHME D'ANALYSE

## ÉTAPE 1 — Probabilités implicites
P = (1/cote) / Σ(1/cote) → P(Home), P(Draw), P(Away) normalisées.

## ÉTAPE 2 — Force réelle des équipes
Force offensive = BM/match, Force défensive = BE/match, Différence buts, Rendement = pts/pts max.

## ÉTAPE 3 — Forme récente pondérée
V=3, N=1, D=0. Pondération: récent×1.5, ×1.3, ×1.2, ×1.1, ×1.0. → Momentum.

## ÉTAPE 4 — Analyse H2H
domination domicile/extérieur/équilibre. Importance: faible/moyenne/forte.

## ÉTAPE 5 — Classification tactique
OFFENSIF si BM>1.8 et BE>1.0, DÉFENSIF si BM<1.4 et BE<1.0, sinon ÉQUILIBRÉ.

## ÉTAPE 6 — Détection avancée des pièges
Type A: Favori classement MAIS forme faible.
Type B: Favori cotes MAIS attaque faible.
Type C: Favori cotes MAIS H2H défavorable.
Type D: Écart classement important MAIS écart buts faible.
Type E: Cotes orientées MAIS stats équilibrées.

---

# LOGIQUE ANTI-TRAP
0-1 alertes → SAFE (suivre favori)
2 alertes → MODERATE (réduire confiance)
3+ alertes → TRAP (envisager nul/outsider)

# ESTIMATION DES BUTS
xG Home = (Attaque Home + Défense Away)/2, xG Away = (Attaque Away + Défense Home)/2. Ajuster forme/H2H/classement. 0≤buts≤5.

# MARCHÉS COMPLÉMENTAIRES
Estimer: BTTS, Over 2.5, But 1ère période (O/N), Score mi-temps.

# NIVEAU DE CONFIANCE
Base = prob implicite max. +0.05 si forme/classement/H2H cohérent. -0.05 par alerte. Bornes: 0.50-0.95.

# RAISONNEMENT OBLIGATOIRE
7-12 phrases: utiliser cotes, classement, forme, H2H, expliquer score, alertes, confiance.

---

# FORMAT DE SORTIE
Retourner EXCLUSIVEMENT un objet JSON valide contenant un champ "predictions" avec un tableau.
Aucun texte, aucun markdown hors JSON.

{
  "predictions": [
    {
      "scoreHome": 2,
      "scoreAway": 1,
      "confidence": 0.82,
      "reasoning": "...",
      "isAntiTrap": false,
      "firstHalfGoal": true,
      "tendency": "...",
      "dangerLevel": "safe",
      "topScores": [
        { "score": "2-1", "probability": 0.22 },
        { "score": "1-0", "probability": 0.18 }
      ],
      "bttsProb": 0.61,
      "over25Prob": 0.58,
      "firstHalfScore": "1-0",
      "systemHome": "offensif",
      "systemAway": "équilibré",
      "possessionHome": 57,
      "possessionAway": 43
    }
  ]
}

IMPORTANT: JSON valide, possessionHome+possessionAway=100, topScores compatibles score final, valeurs calculées pas inventées.`;

// ─── BUILD USER PROMPT FOR A CHUNK ───────────────────────────────────────────

function buildUserPrompt(matches: any[]): string {
  return matches
    .map((m: any, i: number) => {
      let block = `--- MATCH ${i + 1} ---\n`;
      block += `${m.league ? `[${m.league}] ` : ""}${m.home} vs ${m.away}\n`;
      block += `Cotes: Dom=${m.oddHome} Nul=${m.oddDraw} Ext=${m.oddAway}\n`;

      if (m.rankingHome) {
        const r = m.rankingHome;
        block += `\nClassement ${m.home}: ${r.position}${r.position === 1 ? "er" : "e"} | ${r.played}J | ${r.won}V ${r.drawn}N ${r.lost}D | ${r.goalsFor} buts marqués, ${r.goalsAgainst} encaissés | ${r.points} pts\n`;
      }
      if (m.rankingAway) {
        const r = m.rankingAway;
        block += `Classement ${m.away}: ${r.position}${r.position === 1 ? "er" : "e"} | ${r.played}J | ${r.won}V ${r.drawn}N ${r.lost}D | ${r.goalsFor} buts marqués, ${r.goalsAgainst} encaissés | ${r.points} pts\n`;
      }

      if (m.recentHome?.length > 0) {
        block += `\nForme récente ${m.home}:\n`;
        for (const res of m.recentHome) {
          block += `  ${res.result} ${res.scoreHome}-${res.scoreAway} vs ${res.opponent}\n`;
        }
      }

      if (m.recentAway?.length > 0) {
        block += `\nForme récente ${m.away}:\n`;
        for (const res of m.recentAway) {
          block += `  ${res.result} ${res.scoreHome}-${res.scoreAway} vs ${res.opponent}\n`;
        }
      }

      if (m.headToHead?.length > 0) {
        block += `\nConfrontations directes:\n`;
        for (const h of m.headToHead) {
          block += `  ${h.home} ${h.scoreHome}-${h.scoreAway} ${h.away}\n`;
        }
      }

      return block;
    })
    .join("\n\n");
}

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
          max_tokens: 4096,
          response_format: { type: "json_object" },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        console.log(`[analyze-match] Groq success in ${response.headers.get("x-ratelimit-remaining-requests") || "?"} remaining requests`);
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
        console.error(`[analyze-match] Groq 429 (attempt ${attempt + 1}/${maxRetries + 1}): ${errorBody.substring(0, 200)}`);
        if (attempt === maxRetries) {
          console.error("[analyze-match] Groq exhausted, will fallback to Gemini");
          return null;
        }
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
            temperature: 0.7,
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
  let chunkSize = parseInt(Deno.env.get("AI_CHUNK_SIZE") || "3", 10);
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

      // Small delay between chunks to respect rate limits
      if (ci < chunks.length - 1) {
        await sleep(500);
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
