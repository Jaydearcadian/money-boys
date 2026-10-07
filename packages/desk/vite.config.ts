import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
const proxy = {
  "/api": {
    target: "http://127.0.0.1:3001",
    changeOrigin: true,
  },
  "/health": {
    target: "http://127.0.0.1:3001",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors tsconfig paths. The browser sandbox is shared with the engine so
    // a judge runs the SAME deliberation code the server would, not a copy.
    alias: {
      "@money-boys/engine": fileURLToPath(new URL("../engine/src", import.meta.url)),
    },
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy,
    fs: { allow: ["../.."] },
  },
  preview: {
    port: 3000,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy,
  },
});

