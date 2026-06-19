import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET?.trim() || "http://localhost:3210";
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src")
        }
    },
    server: {
        port: 5180,
        strictPort: true,
        proxy: {
            "/api": {
                target: apiProxyTarget,
                changeOrigin: true
            }
        }
    }
});
