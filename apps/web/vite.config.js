import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  return {
    envDir: root,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@zen/ui": path.join(root, "packages/ui/src"),
        "@zen/domain": path.join(root, "packages/domain"),
      },
    },
    server: {
      fs: { allow: [root] },
      proxy: {
        "/api": {
          target: env.ZEN_API_PROXY || "http://127.0.0.1:3000",
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("recharts")) return "charts";
          },
        },
      },
    },
  };
});
