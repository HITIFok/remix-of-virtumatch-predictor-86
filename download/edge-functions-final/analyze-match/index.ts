// analyze-match/index.ts — Supabase Edge Function
// AI-powered match analysis using Lovable AI gateway
// NO imports — uses Deno.serve() + native fetch

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const { matches } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `Tu es un expert en prédiction de matchs de football virtuels (type bet261.mg/virtuel).
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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Trop de requêtes, réessayez dans quelques secondes." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Crédits épuisés. Rechargez votre compte." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erreur du service IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "[]";

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];
    jsonStr = jsonStr.trim();

    let predictions;
    try {
      predictions = JSON.parse(jsonStr);
      if (!Array.isArray(predictions)) predictions = [predictions];
    } catch {
      console.error("Failed to parse AI response:", jsonStr);
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
