// Vercel Serverless Function — Read Scraped Data Cache
// Replaces direct Neon SELECT from frontend (use-live-matches.ts)
// Returns cached scraped data (matches, results, ranking) for a given league

import postgres from 'postgres';
import { setCorsHeaders } from './_lib/cors.js';

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

// Rate limiting: 30 requests per minute per IP
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowKey = Math.floor(now / RATE_LIMIT_WINDOW_MS);
  const key = `${ip}:${windowKey}`;
  const record = rateLimitStore.get(key);

  if (!record || now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (record.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((record.firstAttempt + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - record.count };
}

// Valid data types stored in scraped_data table
const VALID_DATA_TYPES = ['matches', 'results', 'ranking'];

export default async function handler(req, res) {
  // CORS (GET only)
  setCorsHeaders(req, res, 'GET, OPTIONS', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.retryAfter));
    return res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
  }

  if (!NEON_DATABASE_URL) {
    return res.status(500).json({ success: false, error: 'Server not configured' });
  }

  // Validate required league param
  const league = req.query.league || '';
  if (!league || typeof league !== 'string' || league.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'League query parameter is required' });
  }
  if (league.length > 100) {
    return res.status(400).json({ success: false, error: 'League name too long' });
  }

  try {
    const sql = postgres(NEON_DATABASE_URL);

    // Fetch the latest entries for each data type for this league
    // Order by scraped_at DESC — we want the most recent cache per data_type
    const rows = await sql`
      SELECT DISTINCT ON (data_type)
        id, data_type, league, payload, scraped_at, created_at
      FROM scraped_data
      WHERE league = ${league}
        AND data_type = ANY(${VALID_DATA_TYPES})
      ORDER BY data_type, scraped_at DESC
    `;
    await sql.end();

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        league,
        matches: null,
        results: null,
        ranking: null,
        lastUpdate: null,
      });
    }

    // Extract each data type
    const matchesEntry = rows.find(r => r.data_type === 'matches');
    const resultsEntry = rows.find(r => r.data_type === 'results');
    const rankingEntry = rows.find(r => r.data_type === 'ranking');

    // Most recent scraped_at across all entries
    const allScrapedAt = [matchesEntry, resultsEntry, rankingEntry]
      .filter(Boolean)
      .map(r => r.scraped_at);
    const lastUpdate = allScrapedAt.length > 0
      ? allScrapedAt.sort().reverse()[0]
      : null;

    return res.status(200).json({
      success: true,
      league,
      matches: matchesEntry?.payload || null,
      results: resultsEntry?.payload || null,
      ranking: rankingEntry?.payload || null,
      lastUpdate,
    });
  } catch (err) {
    console.error('[scraped-data] Error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch scraped data' });
  }
}
