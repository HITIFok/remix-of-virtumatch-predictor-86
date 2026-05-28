import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hitif.virutelbet261',
  appName: 'Virutel Bet261',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      backgroundColor: '#1a0a2e',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a0a2e',
      overlaysWebView: false
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    }
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#1a0a2e'
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#1a0a2e'
  }
};

export default config;
