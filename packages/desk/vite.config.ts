import { defineConfig } from "vite";
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

