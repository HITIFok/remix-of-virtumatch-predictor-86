// Vercel Serverless Function — push-odds
// Remplace l'ancienne Supabase Edge Function push-odds
// Reçoit les données scrapées et les stocke dans scraped_data (Neon/Postgres)
// Authentifié par SCRAPER_PUSH_KEY (header x-push-key)

import crypto from 'crypto';
import { setCorsHeaders } from './_lib/cors.js';
import { createSql } from './_lib/db.js';
import { errorResponse, methodNotAllowed, invalidInput, internalError, unauthorized, successResponse } from './_lib/errors.js';
import { createLogger } from './_lib/logger.js';

const log = createLogger('push-odds');

const NEON_URL = process.env.NEON_DATABASE_URL;
const SCRAPER_PUSH_KEY = process.env.SCRAPER_PUSH_KEY;

function timingSafeEqual(a, b) {
  try {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch { return false; }
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
    return methodNotAllowed(res, ['POST']);
  }

  // Check SCRAPER_PUSH_KEY
  if (!SCRAPER_PUSH_KEY) {
    log.error('SCRAPER_PUSH_KEY not configured');
    return internalError(res, null, 'Server not configured');
  }

  const pushKey = req.headers['x-push-key'];
  if (!pushKey || !timingSafeEqual(pushKey, SCRAPER_PUSH_KEY)) {
    return unauthorized(res, 'Invalid push key');
  }

  // Check Neon connection
  if (!NEON_URL) {
    log.error('NEON_DATABASE_URL not configured');
    return internalError(res, null, 'Server not configured');
  }

  const sql = createSql();

  try {
    const body = req.body;
    const { matches, results, ranking, league } = body;

    if (!matches && !results && !ranking) {
      return invalidInput(res, 'No data provided');
    }

    const leagueSlug = league || '';
    const leagueId = body.leagueId || '';
    const now = new Date().toISOString();
    const upsertResults = [];

    // Helper: DELETE old data then INSERT fresh (no UNIQUE constraint on scraped_data)
    async function upsertScrapedData(dataType, payload) {
      await sql`
        DELETE FROM scraped_data
        WHERE data_type = ${dataType} AND league = ${leagueSlug}
      `;
      if (payload.length > 0) {
        await sql`
          INSERT INTO scraped_data (data_type, league, league_id, payload, scraped_at)
          VALUES (${dataType}, ${leagueSlug}, ${leagueId}, ${JSON.stringify(payload)}, ${now})
        `;
      }
    }

    // Upsert matches
    if (Array.isArray(matches)) {
      try {
        await upsertScrapedData('matches', matches);
        upsertResults.push(true);
      } catch (e) {
        log.error('Error upserting matches', undefined, { cause: e });
        upsertResults.push(false);
      }
    }

    // Upsert results
    if (Array.isArray(results)) {
      try {
        await upsertScrapedData('results', results);
        upsertResults.push(true);
      } catch (e) {
        log.error('Error upserting results', undefined, { cause: e });
        upsertResults.push(false);
      }
    }

    // Upsert ranking
    if (Array.isArray(ranking)) {
      try {
        await upsertScrapedData('ranking', ranking);
        upsertResults.push(true);
      } catch (e) {
        log.error('Error upserting ranking', undefined, { cause: e });
        upsertResults.push(false);
      }
    }

    const successCount = upsertResults.filter(Boolean).length;

    return successResponse(res, {
      saved: {
        matches: matches?.length || 0,
        results: results?.length || 0,
        ranking: ranking?.length || 0,
      },
      upserted: successCount,
      timestamp: now,
    });

  } catch (error) {
    log.error('Handler error', undefined, { cause: error });
    return internalError(res, error);
  } finally {
    await sql.end();
  }
}
