import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Try Firecrawl first, then ScraperAPI as fallback for geo-restricted sites
async function scrapeWithFirecrawl(targetUrl: string): Promise<{ markdown: string; html: string; blocked: boolean }> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return { markdown: "", html: "", blocked: true };

  console.log("[Firecrawl] Scraping:", targetUrl);
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: targetUrl,
      formats: ["markdown", "html"],
      onlyMainContent: false,
      waitFor: 12000,
      location: { country: "MG", languages: ["fr"] },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("[Firecrawl] Error:", data);
    return { markdown: "", html: "", blocked: true };
  }

  const markdown = data.data?.markdown || data.markdown || "";
  const html = data.data?.html || data.html || "";

  if (markdown.includes("ACCESS FORBIDDEN") || html.includes("ACCESS FORBIDDEN") || markdown.length < 100) {
    console.log("[Firecrawl] Geo-blocked or insufficient content");
    return { markdown, html, blocked: true };
  }

  return { markdown, html, blocked: false };
}

async function scrapeWithScraperAPI(targetUrl: string): Promise<{ markdown: string; html: string; blocked: boolean }> {
  const apiKey = Deno.env.get("SCRAPER_API_KEY");
  if (!apiKey) {
    console.log("[ScraperAPI] No API key configured");
    return { markdown: "", html: "", blocked: true };
  }

  console.log("[ScraperAPI] Scraping with MG proxy:", targetUrl);
  const scraperUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&country_code=mg&render=true&wait_for_selector=.match,.tab-picker,hg-instant-league-matches&session_number=123`;

  const response = await fetch(scraperUrl, { headers: { "Accept": "text/html" } });

  if (!response.ok) {
    console.error("[ScraperAPI] Error:", response.status);
    return { markdown: "", html: "", blocked: true };
  }

  const html = await response.text();
  console.log("[ScraperAPI] Got HTML length:", html.length);

  if (html.includes("ACCESS FORBIDDEN") || html.length < 200) {
    return { markdown: "", html, blocked: true };
  }

  return { markdown: "", html, blocked: false };
}

async function parseWithAI(markdown: string, html: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return { matches: [], results: [], ranking: [] };

  const content = markdown.length > 500 ? markdown : html;
  if (content.length < 100) return { matches: [], results: [], ranking: [] };

  const parsePrompt = `Analyse ce contenu HTML/Markdown d'un site de paris virtuels (bet261.mg - Instant League).

Le site utilise ces composants Angular :
- "hg-instant-league-matches .match" pour les matchs à venir
- "hg-instant-league-ranking table" pour le classement
- "div.tab-picker" avec onglets Résultats/Classement/Matchs

Extrais TOUTES les données structurées en 3 catégories :

## 1. MATCHES (matchs à venir ou en cours)
Pour chaque match :
- league, home, away, kickoff (HH:MM)
- oddHome, oddDraw, oddAway (number)
- status: "upcoming" | "live" | "finished"
- minute (number ou null), scoreHome, scoreAway (number ou null)

## 2. RESULTS (résultats des matchs terminés)
Pour chaque résultat :
- home, away, scoreHome (number), scoreAway (number), league, matchday

## 3. RANKING (classement)
Pour chaque équipe :
- position, team, played, won, drawn, lost, goalsFor, goalsAgainst, goalDifference, points (tous number sauf team)

Retourne un objet JSON avec { matches: [...], results: [...], ranking: [...] }.
Si une catégorie est vide, retourne un tableau vide.

CONTENU:
${content.slice(0, 30000)}`;

  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Tu es un parser de données de paris sportifs virtuels. Extrais les données structurées avec précision. Retourne UNIQUEMENT du JSON valide sans markdown." },
        { role: "user", content: parsePrompt },
      ],
    }),
  });

  if (!aiResponse.ok) {
    console.error("[AI] Error:", aiResponse.status);
    return { matches: [], results: [], ranking: [] };
  }

  const aiData = await aiResponse.json();
  const rawContent = aiData.choices?.[0]?.message?.content || "{}";
  let jsonStr = rawContent;
  const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];
  jsonStr = jsonStr.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    const ranking = Array.isArray(parsed.ranking) ? parsed.ranking : [];
    console.log(`[AI] Parsed: ${matches.length} matches, ${results.length} results, ${ranking.length} ranking`);
    return { matches, results, ranking };
  } catch {
    console.error("[AI] JSON parse failed:", jsonStr.slice(0, 300));
    return { matches: [], results: [], ranking: [] };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const leagueSlug = body.league || "";
    const baseUrl = "https://bet261.mg/virtual/category/instant-league";
    const targetUrl = leagueSlug ? `${baseUrl}/${leagueSlug}` : baseUrl;

    // Strategy 1: Firecrawl with MG geolocation
    let result = await scrapeWithFirecrawl(targetUrl);

    // Strategy 2: ScraperAPI with MG residential proxy
    if (result.blocked) {
      console.log("Firecrawl blocked, trying ScraperAPI fallback...");
      result = await scrapeWithScraperAPI(targetUrl);
    }

    if (result.blocked) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Site géo-restreint. Configurez SCRAPER_API_KEY pour utiliser un proxy Madagascar.",
          geoBlocked: true,
          hint: "Créez un compte sur https://www.scraperapi.com/ et ajoutez la clé API.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse with AI
    const { matches, results, ranking } = await parseWithAI(result.markdown, result.html);

    return new Response(
      JSON.stringify({
        success: true,
        matches,
        results,
        ranking,
        scrapedAt: new Date().toISOString(),
        rawLength: (result.markdown || result.html).length,
        url: targetUrl,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Scrape error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Erreur inconnue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
