import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icon.png", "apple-touch-icon.png"],
      manifest: {
        name: "VirtuL - Prédictions Sportives",
        short_name: "VirtuL",
        description: "Application de prédictions sportives virtuelles garantie par algorithme",
        theme_color: "#0a0a0d",
        background_color: "#0a0a0d",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "icon.png",
            sizes: "1024x1024",
            type: "image/png",
            purpose: "any maskable"
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "icon-144.png",
            sizes: "144x144",
            type: "image/png"
          },
          {
            src: "icon-96.png",
            sizes: "96x96",
            type: "image/png"
          },
          {
            src: "icon-72.png",
            sizes: "72x72",
            type: "image/png"
          },
          {
            src: "icon-48.png",
            sizes: "48x48",
            type: "image/png"
          }
        ],
        categories: ["sports", "entertainment"],
        shortcuts: [
          {
            name: "Matchs en direct",
            short_name: "Matchs",
            description: "Voir les matchs en direct",
            url: "/live",
            icons: [{ src: "icon-96.png", sizes: "96x96" }]
          },
          {
            name: "Historique",
            short_name: "Historique",
            description: "Voir l'historique des prédictions",
            url: "/history",
            icons: [{ src: "icon-96.png", sizes: "96x96" }]
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.neon\.tech\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "neon-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },

        ]
      },
      devOptions: {
        enabled: mode === "development"
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Supprimer console.log et console.info en production
    // console.error et console.warn sont conserves pour le debugging
    target: "es2020",
    minify: "esbuild",
    rollupOptions: {
      // Exclude Node.js-only 'postgres' package from browser bundle
      // It's only used by api/*.js serverless functions
      external: ['postgres'],
    },
  },
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
    dropLabels: mode === "production" ? ["dev"] : [],
  },
}));
