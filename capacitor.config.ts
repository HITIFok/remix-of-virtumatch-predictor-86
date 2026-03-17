import type { CapacitorConfig } from '@capacitor/cli';

import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar } from '@capacitor/status-bar';

const config: CapacitorConfig = {
  appId: 'com.hitif.virtuxxs',
  appName: 'VirtuXXS',
  webDir: 'dist',
  server: {
    android: {
      backgroundColor: '#0a0a0d',
      allowMixedContent: true,
    }
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a0a0d',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
    backgroundColor: '#0a0a0d',
  }
  }
};

export default config;
