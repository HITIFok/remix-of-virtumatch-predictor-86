// ─── Browser Push Notification + Sound System ─────────────────────────────────
// Handles native browser notifications and optional sound alerts
// for exploit detections (early results before kickoff).

const SOUND_ENABLED_KEY = 'vm_notif_sound';
const PERMISSION_REQUESTED_KEY = 'vm_notif_permission_asked';

// Sound file path (static asset in /public)
const NOTIFICATION_SOUND_URL = '/notification-chime.wav';
const BET261_BASE = 'https://bet261.mg';

/**
 * Check if the browser supports notifications.
 */
export function supportsNotifications(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Current notification permission state.
 */
export function getNotificationPermission(): NotificationPermission {
  if (!supportsNotifications()) return 'denied';
  return Notification.permission;
}

/**
 * Whether we already asked the user for permission (avoid re-asking).
 */
export function hasAlreadyAskedPermission(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(PERMISSION_REQUESTED_KEY) === 'true';
}

/**
 * Request notification permission from the browser.
 * Returns the permission state after the request.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!supportsNotifications()) return 'denied';

  const permission = await Notification.requestPermission();
  localStorage.setItem(PERMISSION_REQUESTED_KEY, 'true');
  return permission;
}

/**
 * Whether sound alerts are enabled (stored in localStorage).
 */
export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SOUND_ENABLED_KEY) !== 'false'; // default: enabled
}

/**
 * Toggle sound alerts on/off.
 */
export function toggleSound(): boolean {
  const current = isSoundEnabled();
  localStorage.setItem(SOUND_ENABLED_KEY, current ? 'false' : 'true');
  return !current;
}

/**
 * Play a short notification sound.
 */
export function playNotificationSound(): void {
  if (!isSoundEnabled()) return;

  try {
    const audio = new Audio(NOTIFICATION_SOUND_URL);
    audio.volume = 0.5;
    audio.play().catch(() => {
      // Autoplay blocked — ignore silently
    });
  } catch {
    // Audio not supported — ignore
  }
}

/**
 * Send a native browser push notification.
 * Falls back silently if permission not granted.
 */
export function sendBrowserNotification(title: string, options?: NotificationOptions): void {
  if (!supportsNotifications()) return;
  if (Notification.permission !== 'granted') return;

  try {
    const notif = new Notification(title, {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      vibrate: [200, 100, 200],
      tag: 'virtumatch-exploit',
      renotify: true,
      requireInteraction: false,
      ...options,
    });

    // Auto-close after 8 seconds
    setTimeout(() => {
      notif.close();
    }, 8000);

    // Click → focus the tab
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  } catch {
    // Notification API error — ignore
  }
}

/**
 * Full exploit notification: browser push + sound.
 * Call this when a new exploit is detected.
 */
export function notifyExploit(
  homeTeam: string,
  awayTeam: string,
  scoreHome: number,
  scoreAway: number,
  leagueName: string,
  howEarlySeconds: number,
  count: number,
  matchId?: number,
): void {
  const earlyText = howEarlySeconds >= 60
    ? `${Math.floor(howEarlySeconds / 60)}m${(howEarlySeconds % 60).toString().padStart(2, '0')}s`
    : `${howEarlySeconds}s`;

  const title = count > 1
    ? `${count} resultats en avance !`
    : `Resultat en avance !`;

  const body = `${homeTeam} ${scoreHome} - ${scoreAway} ${awayTeam} (${earlyText} avant)`;

  // Deep link: click notification → opens bet261 match page
  const bet261Url = matchId ? `${BET261_BASE}/sports/event/${matchId}` : `${BET261_BASE}/virtual`;

  // Play in-app sound
  playNotificationSound();

  // Browser push notification (works even when tab is in background)
  if (!supportsNotifications() || Notification.permission !== 'granted') return;

  try {
    const notif = new Notification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      vibrate: [200, 100, 200],
      tag: `exploit-${Date.now()}`,
      renotify: true,
      requireInteraction: false,
    });

    // Click → open bet261.mg match page directly
    notif.onclick = () => {
      window.open(bet261Url, '_blank', 'noopener,noreferrer');
      notif.close();
    };

    // Auto-close after 8 seconds
    setTimeout(() => {
      notif.close();
    }, 8000);
  } catch {
    // Notification API error — ignore
  }
}
