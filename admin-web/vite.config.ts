import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// En développement, le proxy relaie `/api` vers l'API Express : la console et l'API paraissent
// venir de la même origine, aucun CORS à configurer. Autre cible : `VITE_DEV_API_TARGET`.
// Hors développement (console servie ailleurs), renseigner `VITE_API_BASE_URL` et autoriser
// l'origine côté API avec `CORS_ALLOWED_ORIGINS`.
const apiTarget = process.env.VITE_DEV_API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5173, proxy: { "/api": { target: apiTarget, changeOrigin: true } } },
  test: {
    environment: "jsdom",
    css: false,
    setupFiles: ["./src/test/setup.ts"],
  },
});
