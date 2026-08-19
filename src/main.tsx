import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Initialize Capacitor plugins (for mobile)
async function initCapacitor() {
  try {
    // Dynamic import for Capacitor (only works on mobile)
    const { SplashScreen } = await import('@capacitor/splash-screen');
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const { Preferences } = await import('@capacitor/preferences');
    
    // Hide splash screen after app loads
    await SplashScreen.hide();
    
    // Set dark status bar - IMPORTANT: overlaysWebView false prevents status bar from covering content
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#1a0a2e' });
    
    console.log('Capacitor plugins initialized');
  } catch (e) {
    // Not on mobile, ignore
    console.log('Not running on mobile');
  }
}

// ── Security: Add X-Capacitor-Request header for native app API calls ──
// This header lets the backend identify native Capacitor requests without
// relying on the spoofable Origin: localhost CORS bypass.
if (typeof window !== 'undefined' && (window.location.origin === 'https://localhost' || window.location.origin === 'capacitor://localhost')) {
  const originalFetch = window.fetch;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    // Only add header for our own API calls (not bet261.mg or external)
    if (url && (url.includes('/api/') || url.includes('vercel.app'))) {
      const headers = new Headers(init?.headers);
      if (!headers.has('X-Capacitor-Request')) {
        headers.set('X-Capacitor-Request', 'true');
      }
      return originalFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
}

initCapacitor();

createRoot(document.getElementById("root")!).render(<App />);
