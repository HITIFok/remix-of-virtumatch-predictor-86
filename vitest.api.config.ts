import { defineConfig } from "vitest/config";

// Vitest config for API server-side security tests
// Uses Node environment (not jsdom) because api/ modules use Node.js built-ins (crypto, postgres)
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["api/**/*.{test,spec}.{js,ts}"],
    // Isolate from frontend tests
    name: "api-security",
  },
});
