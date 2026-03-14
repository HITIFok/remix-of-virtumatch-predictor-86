// Supabase Edge Function: auto-scrape
// Scrape Instant League data and store in database
// Can be triggered by cron or manually

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const DATABASE_URL = Deno.env.get('DATABASE_URL')!
const DATABASE_SERVICE_KEY = Deno.env.get('DATABASE_SERVICE_KEY')!

const LEAGUE_ID = "8035"
const API_MATCHES = `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE_ID}/matches`
const API_RANKING = `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE_ID}/ranking`
const API_RESULTS = `https://hg-event-api-prod.sporty-tech.net/api/instantleagues/${LEAGUE_ID}/results?skip=0&take=100`

const HEADERS = {
  "Origin": "https://bet261.mg",
  "Referer": "https://bet261.mg/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json",
}

interface Match {
  id: number
  home: string
  away: string
  round: number
  league: string
  status: string
  oddHome: number
  oddDraw: number
  oddAway: number
  expectedStart: string
}

interface Ranking {
  position: number
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

interface Result {
  home: string
  away: string
  scoreHome: number
  scoreAway: number
  round: number
  league: string
}

async function fetchAPI(url: string): Promise<any> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: HEADERS,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    console.error(`Fetch error for ${url}:`, error)
    return null
  }
}

async function scrapeMatches(): Promise<Match[]> {
  const matches: Match[] = []
  const data = await fetchAPI(API_MATCHES)

  if (data && data.rounds) {
    for (const roundData of data.rounds) {
      const roundNum = roundData.roundNumber || 0

      for (const m of (roundData.matches || [])) {
        try {
          let hasActiveOdds = false
          let oddHome = 0, oddDraw = 0, oddAway = 0

          const eventBetTypes = m.eventBetTypes || []
          for (const betType of eventBetTypes) {
            if (betType.name === "1X2") {
              const items = betType.eventBetTypeItems || []
              for (const item of items) {
                if (item.active && item.bettingAllowed) {
                  hasActiveOdds = true
                }

                const shortName = (item.shortName || "").toUpperCase()
                const oddVal = item.odds || 0

                if (shortName === "1") oddHome = oddVal
                else if (shortName === "X") oddDraw = oddVal
                else if (shortName === "2") oddAway = oddVal
              }
              break
            }
          }

          if (!hasActiveOdds && oddHome === 0) continue

          matches.push({
            id: m.id,
            home: m.homeTeam?.name || "",
            away: m.awayTeam?.name || "",
            round: roundNum,
            league: "Instant League",
            status: "upcoming",
            oddHome,
            oddDraw,
            oddAway,
            expectedStart: m.expectedStart || "",
          })
        } catch (e) {
          console.error("Error parsing match:", e)
        }
      }
    }
  }

  return matches
}

async function scrapeRanking(): Promise<Ranking[]> {
  const ranking: Ranking[] = []
  const data = await fetchAPI(API_RANKING)

  if (data && data.teams) {
    for (const r of data.teams) {
      ranking.push({
        position: r.position || 0,
        team: r.name || "",
        played: (r.won || 0) + (r.lost || 0) + (r.draw || 0),
        won: r.won || 0,
        drawn: r.draw || 0,
        lost: r.lost || 0,
        goalsFor: r.goalsFor || 0,
        goalsAgainst: r.goalsAgainst || 0,
        points: r.points || 0,
      })
    }
  }

  return ranking
}

async function scrapeResults(): Promise<Result[]> {
  const results: Result[] = []
  const data = await fetchAPI(API_RESULTS)

  if (data && data.rounds) {
    for (const roundData of data.rounds) {
      for (const m of (roundData.matches || [])) {
        try {
          const score = m.score || "0:0"
          const parts = score.split(":")
          const scoreHome = parts.length === 2 ? parseInt(parts[0]) : 0
          const scoreAway = parts.length === 2 ? parseInt(parts[1]) : 0

          results.push({
            home: m.homeTeam?.name || "",
            away: m.awayTeam?.name || "",
            scoreHome,
            scoreAway,
            round: roundData.roundNumber || 0,
            league: "Instant League",
          })
        } catch (e) {
          console.error("Error parsing result:", e)
        }
      }
    }
  }

  return results
}

serve(async (req) => {
  const supabase = createClient(DATABASE_URL, DATABASE_SERVICE_KEY)

  try {
    // Check for authorization
    const authHeader = req.headers.get('Authorization')
    const cronKey = req.headers.get('x-cron-key')
    const expectedCronKey = Deno.env.get('CRON_SECRET') || 'bet261_cron_2024'

    // Allow cron requests or requests with valid auth
    const isAuthorized = cronKey === expectedCronKey ||
      authHeader === `Bearer ${DATABASE_SERVICE_KEY}`

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log('Starting scrape...')

    // Scrape all data
    const [matches, ranking, results] = await Promise.all([
      scrapeMatches(),
      scrapeRanking(),
      scrapeResults(),
    ])

    console.log(`Scraped: ${matches.length} matches, ${ranking.length} teams, ${results.length} results`)

    // Check if we got any data
    if (matches.length === 0 && ranking.length === 0 && results.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No data retrieved - API may be geo-blocked or unavailable',
          hint: 'Use Python scraper from Madagascar'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Store in database
    const now = new Date().toISOString()

    // Clear old data and insert new
    const saves: Promise<any>[] = []

    if (matches.length > 0) {
      saves.push(
        supabase.from('scraped_data').upsert({
          data_type: 'matches',
          league: 'Instant League',
          payload: matches,
          scraped_at: now,
        }, { onConflict: 'data_type,league' })
      )
    }

    if (ranking.length > 0) {
      saves.push(
        supabase.from('scraped_data').upsert({
          data_type: 'ranking',
          league: 'Instant League',
          payload: ranking,
          scraped_at: now,
        }, { onConflict: 'data_type,league' })
      )
    }

    if (results.length > 0) {
      saves.push(
        supabase.from('scraped_data').upsert({
          data_type: 'results',
          league: 'Instant League',
          payload: results,
          scraped_at: now,
        }, { onConflict: 'data_type,league' })
      )
    }

    await Promise.all(saves)

    return new Response(
      JSON.stringify({
        success: true,
        scraped_at: now,
        saved: {
          matches: matches.length,
          ranking: ranking.length,
          results: results.length,
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
