// The web app. `bun run web` serves it with hot reload and forwards /api and /ws to the dashboard
// server (DASHBOARD_URL, default http://127.0.0.1:3000 – start that with `bun run dev` or `serve`).
// `bun run build` writes dist/web, which the server serves itself.
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = process.env.DASHBOARD_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // shared with the server: model, texts, PR ↔ ticket links, kanban columns, spaces
      "@shared": fileURLToPath(new URL("../src", import.meta.url)),
    },
  },
  server: {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": target,
      "/ws": { target: target.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    emptyOutDir: true,
  },
});
