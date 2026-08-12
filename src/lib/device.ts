// Shared device ID utility — generates a stable, persistent device identifier
//
// Storage layers (tried in order, first available wins):
//   1. In-memory cache (fastest, lost on page reload)
//   2. localStorage (persistent, but can be cleared by browser/user)
//   3. IndexedDB (backup, survives some localStorage clears)
//   4. Hardware fingerprint (stable per device+browser, no storage needed)
//
// Persistence strategy:
//   On creation: save to localStorage + IndexedDB (fire-and-forget)
//   On read: localStorage first, then fingerprint
//   App startup: DeviceIdRestorer async-checks IndexedDB to restore if localStorage was cleared

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

// Generate a stable fingerprint from hardware/browser characteristics (sync)
function generateFingerprint(): string {
  const parts: string[] = [];
  parts.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);
  parts.push(`${window.devicePixelRatio || 1}`);
  parts.push(String(navigator.hardwareConcurrency || 0));
  parts.push(navigator.platform || '');
  parts.push(navigator.language || '');
  parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  parts.push(navigator.userAgent || '');
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
 * Checks localStorage first. If empty, generates a hardware fingerprint.
 * The fingerprint is deterministic per device+browser → stable across restarts.
 */
export function getDeviceId(): string {
  if (cachedId) return cachedId;

  // 1. localStorage
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id && id.startsWith('dev-')) {
      cachedId = id;
      saveToIDB(id); // backup to IDB
      return id;
    }
  } catch { /* no localStorage */ }

  // 2. Fallback: deterministic fingerprint (stable per device)
  const fp = generateFingerprint();
  cachedId = fp;
  try { localStorage.setItem(STORAGE_KEY, fp); } catch { /* */ }
  saveToIDB(fp); // backup
  return fp;
}

/**
 * Async restore from IndexedDB — call once at app startup.
 * If localStorage was cleared but IndexedDB still has the original device_id,
 * this restores it so the user keeps their predictions/history.
 */
export async function restoreDeviceId(): Promise<string | null> {
  if (cachedId) return null; // already have an ID

  const idbId = await readDeviceIdFromIDB();
  if (!idbId || !idbId.startsWith('dev-')) return null;

  // Check if localStorage has the same or different ID
  let lsId: string | null = null;
  try { lsId = localStorage.getItem(STORAGE_KEY); } catch { /* */ }

  if (lsId === idbId) return null; // already in sync

  // localStorage was cleared or has a different ID → restore IDB backup
  try { localStorage.setItem(STORAGE_KEY, idbId); } catch { /* */ }
  cachedId = idbId;
  console.log(`[DeviceID] Restored from IndexedDB: ${idbId}`);
  return idbId;
}
