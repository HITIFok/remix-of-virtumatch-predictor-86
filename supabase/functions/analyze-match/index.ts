// analyze-match/index.ts — Supabase Edge Function
// AI-powered match analysis using Google Gemini API (direct)
// NO imports — uses Deno.serve() + native fetch

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://virtual-match-hitifproject.vercel.app";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

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

    // --- Google AI Key (set in Supabase Edge Function Secrets) ---
    const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY");
    if (!GOOGLE_AI_KEY) throw new Error("GOOGLE_AI_KEY is not configured");

    const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_AI_KEY}`;

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

    // --- Appel direct à Google Gemini API ---
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Trop de requêtes Google AI. Réessayez dans quelques secondes." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorBody = await response.text();
      console.error("Google AI API error:", response.status, errorBody);
      return new Response(
        JSON.stringify({ error: "Erreur du service Google AI", details: errorBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      console.error("Failed to parse Gemini response:", jsonStr);
      predictions = [];
    }

    return new Response(JSON.stringify({ predictions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("analyze-match error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
