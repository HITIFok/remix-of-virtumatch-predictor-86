// Shared device ID utility — generates a stable, persistent device identifier
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

const STORAGE_KEY = "virtuxxs_device_id";
const IDB_NAME = "virtuxxs_device_store";
const IDB_STORE = "meta";
const IDB_KEY = "device_id";

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

// Save to IndexedDB (fire-and-forget, non-blocking)
function saveToIDB(id: string) {
  try {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(id, IDB_KEY);
      } catch { /* ignore */ }
    };
  } catch { /* ignore */ }
}

// Read from IndexedDB (async)
export async function readDeviceIdFromIDB(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(IDB_STORE, 'readonly');
          const store = tx.objectStore(IDB_STORE);
          const getReq = store.get(IDB_KEY);
          getReq.onsuccess = () => resolve(typeof getReq.result === 'string' ? getReq.result : null);
          getReq.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

// In-memory cache
let cachedId: string | null = null;

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
      saveToIDB(id); // backup
      return id;
    }
  } catch { /* no localStorage */ }

  // 2. Last resort: generate a fingerprint (stable per hardware, no UA)
  const fp = generateFingerprint();
  cachedId = fp;
  try { localStorage.setItem(STORAGE_KEY, fp); } catch { /* */ }
  saveToIDB(fp); // backup
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
