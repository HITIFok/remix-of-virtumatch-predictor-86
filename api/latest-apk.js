// Vercel Serverless Function — returns latest APK download URL from GitHub Actions
import { setCorsHeaders } from './_lib/cors.js';

const GITHUB_REPO = 'HITIFok/remix-of-virtumatch-predictor-86';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cached = { url: null, fetchedAt: 0 };

export default async function handler(req, res) {
  setCorsHeaders(req, res, 'GET, OPTIONS', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end('');
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Return cache if fresh
  if (cached.url && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return res.status(200).json({ url: cached.url });
  }

  try {
    const headers = { 'Accept': 'application/vnd.github+json' };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/artifacts?per_page=5`,
      { headers, signal: AbortSignal.timeout(5000) }
    );

    if (!ghRes.ok) {
      console.error('[latest-apk] GitHub API error:', ghRes.status);
      return res.status(502).json({ error: 'GitHub API unavailable' });
    }

    const data = await ghRes.json();
    // Find the first artifact that looks like an APK
    const apkArtifact = (data.artifacts || []).find(a =>
      a.name.toLowerCase().includes('apk') ||
      a.name.toLowerCase().includes('android') ||
      a.name.toLowerCase().includes('app-release')
    );

    // Fallback: use the most recent artifact
    const artifact = apkArtifact || (data.artifacts || [])[0];

    if (!artifact) {
      return res.status(200).json({ url: null });
    }

    // Build the download URL (works for public repos without token)
    const url = `https://github.com/${GITHUB_REPO}/actions/runs/${artifact.workflow_run.id}/artifacts/${artifact.id}`;

    cached = { url, fetchedAt: Date.now() };
    return res.status(200).json({ url });
  } catch (err) {
    console.error('[latest-apk] Error:', err.message);
    // Return stale cache if available
    if (cached.url) {
      return res.status(200).json({ url: cached.url });
    }
    return res.status(500).json({ error: 'Failed to fetch latest APK' });
  }
};
