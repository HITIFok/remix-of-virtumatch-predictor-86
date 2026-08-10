// Vercel Serverless Function — push-odds
// Remplace l'ancienne Supabase Edge Function push-odds
// Reçoit les données scrapées et les stocke dans scraped_data (Neon/Postgres)
// Authentifié par SCRAPER_PUSH_KEY (header x-push-key)

import { setCorsHeaders } from './_lib/cors.js';
import postgres from 'postgres';

const NEON_URL = process.env.NEON_DATABASE_URL;
const SCRAPER_PUSH_KEY = process.env.SCRAPER_PUSH_KEY;

// Timing-safe comparison to prevent timing attacks
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const result = new Uint8Array(aBytes.length);
  for (let i = 0; i < aBytes.length; i++) {
    result[i] = aBytes[i] ^ bBytes[i];
  }
  return result.every(byte => byte === 0);
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'POST, OPTIONS', 'Content-Type, x-push-key, apikey, Authorization');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end('');
    return;
  }

  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Check SCRAPER_PUSH_KEY
  if (!SCRAPER_PUSH_KEY) {
    console.error('[push-odds] SCRAPER_PUSH_KEY not configured');
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  const pushKey = req.headers['x-push-key'];
  if (!pushKey || !timingSafeEqual(pushKey, SCRAPER_PUSH_KEY)) {
    return res.status(401).json({ success: false, error: 'Invalid push key' });
  }

  // Check Neon connection
  if (!NEON_URL) {
    console.error('[push-odds] NEON_DATABASE_URL not configured');
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  const sql = postgres(NEON_URL);

  try {
    const body = req.body;
    const { matches, results, ranking, league } = body;

    if (!matches && !results && !ranking) {
      return res.status(400).json({ success: false, error: 'No data provided' });
    }

    const leagueSlug = league || '';
    const now = new Date().toISOString();
    const upsertResults = [];

    // Upsert matches
    if (Array.isArray(matches)) {
      try {
        await sql`
          DELETE FROM scraped_data
          WHERE data_type = 'matches' AND league = ${leagueSlug}
        `;
        if (matches.length > 0) {
          await sql`
            INSERT INTO scraped_data (data_type, league, payload, scraped_at)
            VALUES ('matches', ${leagueSlug}, ${JSON.stringify(matches)}, ${now})
            ON CONFLICT (data_type, league)
            DO UPDATE SET payload = ${JSON.stringify(matches)}, scraped_at = ${now}
          `;
        }
        upsertResults.push(true);
      } catch (e) {
        console.error('[push-odds] Error upserting matches:', e.message);
        upsertResults.push(false);
      }
    }

    // Upsert results
    if (Array.isArray(results)) {
      try {
        await sql`
          DELETE FROM scraped_data
          WHERE data_type = 'results' AND league = ${leagueSlug}
        `;
        if (results.length > 0) {
          await sql`
            INSERT INTO scraped_data (data_type, league, payload, scraped_at)
            VALUES ('results', ${leagueSlug}, ${JSON.stringify(results)}, ${now})
            ON CONFLICT (data_type, league)
            DO UPDATE SET payload = ${JSON.stringify(results)}, scraped_at = ${now}
          `;
        }
        upsertResults.push(true);
      } catch (e) {
        console.error('[push-odds] Error upserting results:', e.message);
        upsertResults.push(false);
      }
    }

    // Upsert ranking
    if (Array.isArray(ranking)) {
      try {
        await sql`
          DELETE FROM scraped_data
          WHERE data_type = 'ranking' AND league = ${leagueSlug}
        `;
        if (ranking.length > 0) {
          await sql`
            INSERT INTO scraped_data (data_type, league, payload, scraped_at)
            VALUES ('ranking', ${leagueSlug}, ${JSON.stringify(ranking)}, ${now})
            ON CONFLICT (data_type, league)
            DO UPDATE SET payload = ${JSON.stringify(ranking)}, scraped_at = ${now}
          `;
        }
        upsertResults.push(true);
      } catch (e) {
        console.error('[push-odds] Error upserting ranking:', e.message);
        upsertResults.push(false);
      }
    }

    const successCount = upsertResults.filter(Boolean).length;

    return res.status(200).json({
      success: true,
      saved: {
        matches: matches?.length || 0,
        results: results?.length || 0,
        ranking: ranking?.length || 0,
      },
      upserted: successCount,
      timestamp: now,
    });

  } catch (error) {
    console.error('[push-odds] Error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Unknown error' });
  } finally {
    await sql.end();
  }
}
