import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";
import build from '@hono/vite-build/cloudflare-workers'

export default defineConfig(({ command }) => {
  const config = {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'frontend'),
      },
    },
  }

  if (command === "serve") {
    return {
      ...config,
      plugins: [
        react(),
        cloudflare(),
     ],
    }
  }

   return {
    ...config,
    plugins: [react(), build()]
  }
});
