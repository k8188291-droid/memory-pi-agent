import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  base: "/memory-pi-agent/",
  publicDir: "public",
  resolve: {
    alias: {
      "node:zlib": new URL("./web/shims/zlib.js", import.meta.url).pathname,
    },
  },
  build: {
    outDir: "../docs",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
