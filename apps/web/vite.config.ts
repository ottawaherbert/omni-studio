import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const backendTarget = env.VITE_BACKEND_URL || "http://127.0.0.1:3000";
  return {
    root: __dirname,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": repoRoot,
      },
    },
    server: {
      fs: { allow: [repoRoot] },
      hmr: process.env.DISABLE_HMR !== "true",
      proxy: {
        "/api": { target: backendTarget, changeOrigin: true },
        "/media": { target: backendTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: path.resolve(repoRoot, "dist"),
      emptyOutDir: true,
    },
  };
});
