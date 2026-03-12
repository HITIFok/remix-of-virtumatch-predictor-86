import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const leagueSlug = body.league || "";
    const baseUrl = "https://bet261.mg/virtual/category/instant-league";
    const targetUrl = leagueSlug ? `${baseUrl}/${leagueSlug}` : baseUrl;

    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl non configuré" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Scraping URL:", targetUrl);

    // Scrape with Firecrawl using Madagascar geolocation + long wait for dynamic SPA content
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
        location: {
          country: "MG",
          languages: ["fr"],
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Firecrawl error:", data);
      return new Response(
        JSON.stringify({ success: false, error: data.error || `Erreur ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const markdown = data.data?.markdown || data.markdown || "";
    const html = data.data?.html || data.html || "";

    console.log("Raw content length - markdown:", markdown.length, "html:", html.length);

    // Check if we got blocked by geo-restriction
    if (markdown.includes("ACCESS FORBIDDEN") || html.includes("ACCESS FORBIDDEN")) {
      console.error("Geo-restricted: site not accessible from this location");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Site géo-restreint. Accessible uniquement depuis Madagascar.",
          geoBlocked: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use AI to parse structured data from the scraped content
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: true, raw: markdown, matches: [], ranking: [], results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsePrompt = `Analyse ce contenu HTML/Markdown d'un site de paris virtuels (bet261.mg - Instant League).

Le site utilise ces composants Angular :
- "hg-instant-league-matches .match" pour les matchs à venir
- "hg-instant-league-ranking table" pour le classement
- "div.tab-picker" avec onglets Résultats/Classement/Matchs

Extrais TOUTES les données structurées en 3 catégories :

## 1. MATCHES (matchs à venir ou en cours)
Pour chaque match :
- league: nom de la ligue/championnat
- home: équipe domicile
- away: équipe extérieur  
- kickoff: heure du match (HH:MM)
- oddHome: cote victoire domicile (number)
- oddDraw: cote match nul (number)
- oddAway: cote victoire extérieur (number)
- status: "upcoming" | "live" | "finished"
- minute: minute en cours si live (number ou null)
- scoreHome: score domicile si live/fini (number ou null)
- scoreAway: score extérieur si live/fini (number ou null)

## 2. RESULTS (résultats des matchs terminés)
Pour chaque résultat :
- home: équipe domicile
- away: équipe extérieur
- scoreHome: score domicile (number)
- scoreAway: score extérieur (number)
- league: ligue
- matchday: journée si disponible

## 3. RANKING (classement)
Pour chaque équipe :
- position: rang (number)
- team: nom de l'équipe
- played: matchs joués (number)
- won: victoires (number)
- drawn: nuls (number)
- lost: défaites (number)
- goalsFor: buts marqués (number)
- goalsAgainst: buts encaissés (number)
- goalDifference: différence de buts (number)
- points: points (number)

Retourne un objet JSON avec { matches: [...], results: [...], ranking: [...] }.
Si une catégorie est vide ou non trouvée, retourne un tableau vide.

CONTENU MARKDOWN:
${markdown.slice(0, 20000)}

CONTENU HTML (partiel):
${html.slice(0, 20000)}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "Tu es un parser de données de paris sportifs virtuels. Extrais les données structurées avec précision. Retourne UNIQUEMENT du JSON valide sans markdown.",
          },
          { role: "user", content: parsePrompt },
        ],
      }),
    });

    let matches: any[] = [];
    let results: any[] = [];
    let ranking: any[] = [];

    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content || "{}";
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1];
      jsonStr = jsonStr.trim();

      try {
        const parsed = JSON.parse(jsonStr);
        matches = Array.isArray(parsed.matches) ? parsed.matches : [];
        results = Array.isArray(parsed.results) ? parsed.results : [];
        ranking = Array.isArray(parsed.ranking) ? parsed.ranking : [];
        console.log(`Parsed: ${matches.length} matches, ${results.length} results, ${ranking.length} ranking entries`);
      } catch {
        console.error("Failed to parse AI data:", jsonStr.slice(0, 500));
        // Fallback: try parsing as array (old format)
        try {
          const arr = JSON.parse(jsonStr);
          if (Array.isArray(arr)) matches = arr;
        } catch {
          // ignore
        }
      }
    } else {
      console.error("AI response error:", aiResponse.status);
    }

    return new Response(
      JSON.stringify({
        success: true,
        matches,
        results,
        ranking,
        scrapedAt: new Date().toISOString(),
        rawLength: markdown.length,
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
