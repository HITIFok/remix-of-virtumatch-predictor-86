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
  } catch {
    // Not on mobile — expected in web browser, no action needed
  }
}

// ── Phase 5.3.54.1 — REMOVED the X-Capacitor-Request fetch monkey-patch ──
// Previously, this block intercepted window.fetch when the WebView origin was
// 'https://localhost' or 'capacitor://localhost' (i.e., running in the APK)
// and added the custom header 'X-Capacitor-Request: true' to every /api/*
// call. The header was used by the backend's V-02 (now-removed) CORS bypass
// that allowed any request carrying this header to skip origin validation.
//
// The V-02 fix (in api/_lib/cors.js L42-50) REMOVED that bypass — the
// backend no longer reads or honors the X-Capacitor-Request header. But
// the frontend monkey-patch was left behind, still adding the header.
//
// This caused a CORS failure in the APK because:
//   1. The browser sees X-Capacitor-Request (a non-simple custom header)
//      in the request → triggers a CORS preflight (OPTIONS)
//   2. The server responds with:
//      Access-Control-Allow-Headers: Content-Type, Authorization, x-device-id
//      (X-Capacitor-Request is NOT in the allowlist)
//   3. The browser blocks the actual request because the requested header
//      is not permitted by Access-Control-Allow-Headers
//   4. fetch() rejects with TypeError 'Failed to fetch'
//   5. useLiveMatches.ts L144 catches → returns null
//   6. setError(getFriendlyError(leagueName)) fires
//   7. UI displays: "Les données en direct pour English League ne sont pas
//      disponibles pour le moment. Veuillez réessayer dans quelques instants."
//
// Removing the monkey-patch fixes the APK runtime error. The backend V-02
// fix's intended design (per its comment in cors.js L26-41) is that native
// Capacitor apps are authenticated via HMAC device tokens (Authorization:
// Device <token>) — NOT via the X-Capacitor-Request header. Capacitor
// origins (https://localhost, capacitor://localhost) are already in the
// DEFAULT_ORIGINS allowlist (cors.js L5-13), so legitimate native requests
// pass the origin check normally without any special header.

initCapacitor();

createRoot(document.getElementById("root")!).render(<App />);
