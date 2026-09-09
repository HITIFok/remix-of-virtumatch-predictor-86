// Shared Resend Email Utility
// Phase I — Centralizes lazy-load Resend pattern duplicated in auth.js + premium-activate.js

// Lazy-load Resend to avoid import-time crash if package is missing
// (Not all environments have the resend package installed)
let _ResendClass = null;

async function getResendClass() {
  if (_ResendClass !== null) return _ResendClass;
  try {
    const mod = await import('resend');
    _ResendClass = mod.Resend;
  } catch {
    _ResendClass = null;
  }
  return _ResendClass;
}

/**
 * Get a Resend client instance, or null if not configured.
 * Uses lazy loading to avoid import-time errors when the package is missing.
 *
 * @returns {object|null} Resend client instance or null
 */
export async function getResend() {
  const ResendClass = await getResendClass();
  if (!ResendClass || !process.env.RESEND_API_KEY) return null;
  return new ResendClass(process.env.RESEND_API_KEY);
}

/** Resend sender email (from env or default) */
export const RESEND_FROM = process.env.RESEND_FROM || 'VirtuMatch <onboarding@resend.dev>';

/** App URL for magic link generation */
export const APP_URL = process.env.APP_URL || 'https://virtual-match-hitifproject.vercel.app';
