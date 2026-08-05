import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  base: "/Prismboy_NPM_Package/",
  build: {
    outDir: "dist-demo",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
