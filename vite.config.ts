import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import cesium from "vite-plugin-cesium";

// vite-plugin-cesium ships a callable default export but its declarations are
// interpreted as a namespace by this project's NodeNext config.
const cesiumPlugin = cesium as unknown as (options?: { rebuildCesium?: boolean }) => Plugin;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), cesiumPlugin({ rebuildCesium: true })],
  resolve: {
    alias: {
      "@": `${import.meta.dirname}/src`,
    },
  },
});
