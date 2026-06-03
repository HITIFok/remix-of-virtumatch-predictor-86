// analyze-match/index.ts — Supabase Edge Function
// AI-powered match analysis — Multi-provider: Groq (primary) + Google Gemini (fallback)
// NO imports — uses Deno.serve() + native fetch
//
// v14: Switched to Groq as primary AI provider (llama-3.3-70b-versatile)
//      with Google Gemini as automatic fallback.
//      Each provider has its own retry with exponential backoff.

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

* Position
* Points
* Buts marqués
* Buts encaissés
* Différence de buts

## 3. Forme récente

5 derniers matchs :

* Victoire (V)
* Nul (N)
* Défaite (D)

avec les scores associés.

## 4. Historique H2H

Confrontations directes entre les deux équipes.

---

# ALGORITHME D'ANALYSE

## ÉTAPE 1 — Probabilités implicites

Calculer :

P = (1/cote) / Σ(1/cote)

Produire :

* P(Home)
* P(Draw)
* P(Away)

Normalisées.

---

## ÉTAPE 2 — Force réelle des équipes

Calculer :

### Force offensive

Buts marqués / match

### Force défensive

Buts encaissés / match

### Différence de buts

(BM - BE)

### Rendement global

(Points obtenus / Points maximum possibles)

---

## ÉTAPE 3 — Forme récente pondérée

Attribuer :

* Victoire = 3 points
* Nul = 1 point
* Défaite = 0 point

Pondération :

Match le plus récent : x 1.5
Deuxième : x 1.3
Troisième : x 1.2
Quatrième : x 1.1
Cinquième : x 1.0

Déterminer :

* Momentum positif
* Momentum neutre
* Momentum négatif

---

## ÉTAPE 4 — Analyse H2H

Évaluer :

* domination domicile
* domination extérieur
* équilibre

Importance :

* faible si H2H anciens
* moyenne si résultats mixtes
* forte si tendance répétée

---

## ÉTAPE 5 — Classification tactique

Déterminer automatiquement :

### OFFENSIF

Si BM > 1.8 et BE > 1.0

### DÉFENSIF

Si BM < 1.4 et BE < 1.0

### ÉQUILIBRÉ

Tous les autres cas.

---

## ÉTAPE 6 — Détection avancée des pièges

Déclencher une ALERTE lorsque :

### Piège Type A
Favori au classement MAIS forme récente faible.

### Piège Type B
Favori des cotes MAIS attaque moins performante.

### Piège Type C
Favori des cotes MAIS H2H défavorable.

### Piège Type D
Écart de classement important MAIS écart de buts faible.

### Piège Type E
Cotes fortement orientées MAIS statistiques équilibrées.

---

# LOGIQUE ANTI-TRAP

Nombre d'alertes :

0 → SAFE
1 → SAFE
2 → MODERATE
3+ → TRAP

Règle :

* 0 ou 1 alerte → suivre le favori
* 2 alertes → réduire la confiance
* 3 alertes ou plus → envisager le nul ou l'outsider

Ne jamais basculer automatiquement.
Toujours justifier par les statistiques.

---

# ESTIMATION DES BUTS

Calculer :

Expected Goals simplifiés :

xG Home = (Attaque Home + Défense Away)/2
xG Away = (Attaque Away + Défense Home)/2

Ajuster avec :

* forme récente
* H2H
* classement

Limiter :

0 ≤ buts ≤ 5

---

# MARCHÉS COMPLÉMENTAIRES

Estimer :

## BTTS
Both Teams To Score

## Over 2.5
Plus de 2.5 buts

## But en première période
Oui / Non

## Score mi-temps
Le plus probable.

---

# NIVEAU DE CONFIANCE

Calcul :

Base = probabilité implicite maximale

Ajustements :

+0.05 si forme cohérente
+0.05 si classement cohérent
+0.05 si H2H cohérent
-0.05 par alerte piège

Bornes :

0.50 à 0.95

---

# RAISONNEMENT OBLIGATOIRE

Le champ reasoning doit :

* utiliser les cotes
* utiliser le classement
* utiliser la forme récente
* utiliser les H2H
* expliquer le score proposé
* expliquer les alertes détectées
* justifier le niveau de confiance

Minimum : 7 phrases.
Maximum : 12 phrases.

---

# FORMAT DE SORTIE

Retourner EXCLUSIVEMENT un tableau JSON valide.
Aucun texte. Aucune explication. Aucun markdown.

Structure :

[
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
      { "score": "1-0", "probability": 0.18 },
      { "score": "2-0", "probability": 0.14 }
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

IMPORTANT :

* JSON strictement valide.
* Pas de commentaires.
* Pas de texte hors JSON.
* Les probabilités doivent être cohérentes.
* La somme possessionHome + possessionAway = 100.
* Les topScores doivent être compatibles avec le score final prédit.
* Les valeurs doivent être calculées à partir des données fournies et non inventées.`;

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

    // --- Build enriched user prompt with ranking, results, H2H ---
    const userPrompt = matches
      .map((m: any, i: number) => {
        let block = `--- MATCH ${i + 1} ---\n`;
        block += `${m.league ? `[${m.league}] ` : ""}${m.home} vs ${m.away}\n`;
        block += `Cotes: Dom=${m.oddHome} Nul=${m.oddDraw} Ext=${m.oddAway}\n`;

        // Classement
        if (m.rankingHome) {
          const r = m.rankingHome;
          block += `\nClassement ${m.home}: ${r.position}${r.position === 1 ? "er" : "e"} | ${r.played}J | ${r.won}V ${r.drawn}N ${r.lost}D | ${r.goalsFor} buts marqués, ${r.goalsAgainst} encaissés | ${r.points} pts\n`;
        }
        if (m.rankingAway) {
          const r = m.rankingAway;
          block += `Classement ${m.away}: ${r.position}${r.position === 1 ? "er" : "e"} | ${r.played}J | ${r.won}V ${r.drawn}N ${r.lost}D | ${r.goalsFor} buts marqués, ${r.goalsAgainst} encaissés | ${r.points} pts\n`;
        }

        // Résultats récents domicile
        if (m.recentHome?.length > 0) {
          block += `\nForme récente ${m.home}:\n`;
          for (const res of m.recentHome) {
            block += `  ${res.result} ${res.scoreHome}-${res.scoreAway} vs ${res.opponent}\n`;
          }
        }

        // Résultats récents extérieur
        if (m.recentAway?.length > 0) {
          block += `\nForme récente ${m.away}:\n`;
          for (const res of m.recentAway) {
            block += `  ${res.result} ${res.scoreHome}-${res.scoreAway} vs ${res.opponent}\n`;
          }
        }

        // Confrontations directes
        if (m.headToHead?.length > 0) {
          block += `\nConfrontations directes:\n`;
          for (const h of m.headToHead) {
            block += `  ${h.home} ${h.scoreHome}-${h.scoreAway} ${h.away}\n`;
          }
        }

        return block;
      })
      .join("\n\n");

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
