// Shared device ID utility — generates a stable, persistent device identifier
// with HMAC token authentication.
//
// Strategy:
//   1. In-memory cache (instant, lost on reload)
//   2. localStorage (persistent across page loads)
//   3. IndexedDB (backup — survives most cache clears)
//   4. Hardware fingerprint (LAST RESORT — only on first-ever visit)
//
// IMPORTANT: The fingerprint intentionally excludes navigator.userAgent
// because it changes on every browser update, which would break device_id
// stability and disconnect premium for all users on browser update.
//
// AUTH TOKEN:
//   Each device registers with the server to get a per-device secret.
//   The secret is stored in IndexedDB (secure, not accessible to JS on other origins).
//   All API requests include an HMAC-signed token in the Authorization header.

import { config } from '@/config/env';

const STORAGE_KEY = "virtuxxs_device_id";
const SECRET_KEY = "virtuxxs_device_secret";
const IDB_NAME = "virtuxxs_device_store";
const IDB_STORE = "meta";
const IDB_KEY_DEVICE = "device_id";
const IDB_KEY_SECRET = "device_secret";

// Simple synchronous hash (djb2 — fast, decent distribution)
function hashStr(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// Generate a STABLE fingerprint from hardware characteristics only.
// Deliberately excludes userAgent (changes on browser update).
function generateFingerprint(): string {
  const parts: string[] = [];
  // Screen hardware (very stable — doesn't change unless monitor changes)
  parts.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);
  // GPU scaling factor
  parts.push(`${window.devicePixelRatio || 1}`);
  // CPU thread count
  parts.push(String(navigator.hardwareConcurrency || 0));
  // OS platform (doesn't change unless OS changes)
  parts.push(navigator.platform || '');
  // Language preference
  parts.push(navigator.language || '');
  // Timezone
  parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  return `dev-${hashStr(parts.join('||'))}`;
}

// ─── IndexedDB helpers ─────────────────────────────────────────────────────

function openIDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function saveToIDB(key: string, value: string) {
  try {
    openIDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
      } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

async function readFromIDB(key: string): Promise<string | null> {
  const db = await openIDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(key);
      getReq.onsuccess = () => resolve(typeof getReq.result === 'string' ? getReq.result : null);
      getReq.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

// Save device_id to IndexedDB (fire-and-forget, non-blocking) — legacy key
function saveToIDB_legacy(id: string) { saveToIDB(IDB_KEY_DEVICE, id); }

// Read from IndexedDB (async) — legacy key
export async function readDeviceIdFromIDB(): Promise<string | null> {
  return readFromIDB(IDB_KEY_DEVICE);
}

// ─── In-memory caches ─────────────────────────────────────────────────────

let cachedId: string | null = null;
let cachedSecret: string | null = null;
let registrationPromise: Promise<string | null> | null = null;

// ─── HMAC Token Generation (Web Crypto API — async) ────────────────────────

/**
 * Generate an HMAC-SHA256 device token.
 * Format: base64url(timestamp).base64url(hmac)
 *
 * The token proves the client knows the device secret without revealing it.
 */
async function generateDeviceToken(deviceId: string, secret: string): Promise<string> {
  const timestamp = Date.now().toString();
  const message = `${deviceId}:${timestamp}`;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);

  const tsB64 = btoa(timestamp).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${tsB64}.${sigB64}`;
}

// ─── Device Registration ──────────────────────────────────────────────────

/**
 * Register this device with the server and obtain a per-device secret.
 * The secret is stored in IndexedDB (primary) and localStorage (backup).
 * This is called automatically on first launch and when the secret is missing.
 */
async function ensureRegistered(deviceId: string): Promise<string | null> {
  // Check if we already have a secret
  if (cachedSecret) return cachedSecret;

  try {
    const idbSecret = await readFromIDB(IDB_KEY_SECRET);
    if (idbSecret) {
      cachedSecret = idbSecret;
      // Also back up to localStorage
      try { localStorage.setItem(SECRET_KEY, idbSecret); } catch { /* */ }
      return idbSecret;
    }
  } catch { /* ignore */ }

  try {
    const lsSecret = localStorage.getItem(SECRET_KEY);
    if (lsSecret) {
      cachedSecret = lsSecret;
      saveToIDB(IDB_KEY_SECRET, lsSecret);
      return lsSecret;
    }
  } catch { /* ignore */ }

  // No secret found — register with server
  console.log('[DeviceAuth] No secret found, registering device...');
  try {
    const res = await fetch(`${config.api.deviceRegister}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({ device_id: deviceId }),
    });

    if (!res.ok) {
      console.error('[DeviceAuth] Registration failed:', res.status);
      return null;
    }

    const data = await res.json();
    if (!data.success || !data.device_secret) {
      console.error('[DeviceAuth] Registration response invalid');
      return null;
    }

    const secret = data.device_secret;
    cachedSecret = secret;

    // Persist secret
    try { localStorage.setItem(SECRET_KEY, secret); } catch { /* */ }
    saveToIDB(IDB_KEY_SECRET, secret);

    console.log('[DeviceAuth] Device registered successfully');
    return secret;
  } catch (err) {
    console.error('[DeviceAuth] Registration error:', err);
    return null;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Synchronous getDeviceId — used by most code.
 * Priority: in-memory cache → localStorage → generate new fingerprint.
 *
 * The fingerprint is the LAST resort. On normal usage, the ID from
 * localStorage or IndexedDB is always preferred so it stays stable.
 */
export function getDeviceId(): string {
  if (cachedId) return cachedId;

  // 1. localStorage (most common — survives page reloads)
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id && id.startsWith('dev-')) {
      cachedId = id;
      saveToIDB_legacy(id); // backup
      return id;
    }
  } catch { /* no localStorage */ }

  // 2. Last resort: generate a fingerprint (stable per hardware, no UA)
  const fp = generateFingerprint();
  cachedId = fp;
  try { localStorage.setItem(STORAGE_KEY, fp); } catch { /* */ }
  saveToIDB_legacy(fp); // backup
  return fp;
}

/**
 * Async restore from IndexedDB — call once at app startup.
 * If localStorage was cleared but IndexedDB still has the original device_id,
 * this restores it so the user keeps their predictions and premium.
 *
 * CRITICAL: This MUST run before any API calls that use getDeviceId(),
 * otherwise a new fingerprint would be generated and the user loses their data.
 */
export async function restoreDeviceId(): Promise<string | null> {
  if (cachedId) return null; // already have an ID from localStorage

  const idbId = await readDeviceIdFromIDB();
  if (!idbId || !idbId.startsWith('dev-')) return null;

  // Check if localStorage has the same or different ID
  let lsId: string | null = null;
  try { lsId = localStorage.getItem(STORAGE_KEY); } catch { /* */ }

  if (lsId === idbId) {
    // Already in sync — just cache it
    cachedId = idbId;
    return null;
  }

  if (lsId && lsId.startsWith('dev-')) {
    // localStorage has a DIFFERENT device_id — don't overwrite!
    // This can happen if the user used the migration tool.
    cachedId = lsId;
    return null;
  }

  // localStorage is empty → restore from IndexedDB
  try { localStorage.setItem(STORAGE_KEY, idbId); } catch { /* */ }
  cachedId = idbId;
  console.log(`[DeviceID] Restored from IndexedDB: ${idbId}`);
  return idbId;
}

/**
 * Get auth headers for an API request.
 * Returns an object with Authorization header containing HMAC device token.
 * Falls back to plain x-device-id header if token generation fails.
 *
 * Usage: fetch(url, { headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } })
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const deviceId = getDeviceId();
  const secret = await ensureRegistered(deviceId);

  if (secret) {
    try {
      const token = await generateDeviceToken(deviceId, secret);
      return {
        'Authorization': `Device ${token}`,
        'x-device-id': deviceId, // Still send device_id for backward compat
      };
    } catch (err) {
      console.warn('[DeviceAuth] Token generation failed, falling back to plain:', err);
    }
  }

  // Fallback: plain device_id (server will log a warning)
  return { 'x-device-id': deviceId };
}

/**
 * Synchronous version that returns just the x-device-id header.
 * Use this when async is not possible (e.g., in synchronous contexts).
 * The server will accept this during the migration period.
 */
export function getPlainAuthHeaders(): Record<string, string> {
  const deviceId = getDeviceId();
  return { 'x-device-id': deviceId };
}

/**
 * Ensure the device is registered with the server.
 * Call this early in the app lifecycle to pre-fetch the secret.
 */
export async function initDeviceAuth(): Promise<void> {
  const deviceId = getDeviceId();
  if (!deviceId) return;

  // Deduplicate concurrent calls
  if (!registrationPromise) {
    registrationPromise = ensureRegistered(deviceId);
  }
  await registrationPromise;
  registrationPromise = null;
}
