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
    const targetUrl = body.url || "https://bet261.mg/virtual";

    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl non configuré" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let formattedUrl = targetUrl.trim();
    if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log("Scraping URL:", formattedUrl);

    // Try scraping with extended wait for dynamic content
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: ["markdown", "html"],
        onlyMainContent: false,
        waitFor: 8000,
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

    // Extract content
    const markdown = data.data?.markdown || data.markdown || "";
    const html = data.data?.html || data.html || "";

    // Now use AI to parse the match data from the scraped content
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      // Return raw scraped data if no AI key
      return new Response(JSON.stringify({ success: true, raw: markdown, matches: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsePrompt = `Analyse ce contenu HTML/Markdown d'un site de paris virtuels (bet261.mg/virtual) et extrais TOUS les matchs disponibles.

Pour chaque match, extrais :
- league: nom de la ligue/championnat
- home: équipe domicile
- away: équipe extérieur
- kickoff: heure du match (format HH:MM ou datetime si disponible)
- oddHome: cote victoire domicile (number)
- oddDraw: cote match nul (number)
- oddAway: cote victoire extérieur (number)
- status: "upcoming" | "live" | "finished"
- minute: minute en cours si live (number ou null)
- scoreHome: score domicile si live/fini (number ou null)
- scoreAway: score extérieur si live/fini (number ou null)
- stats: objet avec toutes les statistiques disponibles (possession, tirs, corners, cartons, etc.)

Retourne UNIQUEMENT un tableau JSON valide. Si tu ne peux pas extraire de matchs, retourne [].

CONTENU MARKDOWN:
${markdown.slice(0, 15000)}

CONTENU HTML (partiel):
${html.slice(0, 15000)}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Tu es un parser de données de paris sportifs virtuels. Extrais les données structurées avec précision. Retourne UNIQUEMENT du JSON valide." },
          { role: "user", content: parsePrompt },
        ],
      }),
    });

    let matches: any[] = [];

    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content || "[]";
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1];
      jsonStr = jsonStr.trim();

      try {
        matches = JSON.parse(jsonStr);
        if (!Array.isArray(matches)) matches = [matches];
      } catch {
        console.error("Failed to parse AI match data:", jsonStr.slice(0, 500));
        matches = [];
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        matches,
        scrapedAt: new Date().toISOString(),
        rawLength: markdown.length,
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
