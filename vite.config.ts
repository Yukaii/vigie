import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  return {
    plugins: [
      react(),
      cloudflare(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'frontend'),
      },
    },
    ...(isDev
      ? {
          define: {
            // stub out a minimal process.stdout
            'process.stdout': {
              isTTY: false,
              write: () => {},
            },
            'process.stderr': {
              isTTY: false,
              write: () => {},
            },
          },
        }
      : {}),
  };
});
