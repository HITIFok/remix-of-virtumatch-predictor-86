import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}

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

initCapacitor();

createRoot(document.getElementById("root")!).render(<App />);
