import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  // .env / .env.dev / .env.local etc. are shared with the Go backend
  // (backend/internal/config.Load resolves them relative to the repo root —
  // the parent of backend/, found by walking up for backend/go.mod) and live
  // at the repo root, not under web/. Vite's default envDir is the directory
  // holding this config file, which is now web/ instead of the repo root —
  // without this override, `npm run dev` / `vite build --mode dev` would
  // silently stop finding VITE_API_URL and fall back to its hardcoded
  // default (see src/lib/api-client.ts) instead of reading .env.dev.
  envDir: path.resolve(__dirname, ".."),
  server: {
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})