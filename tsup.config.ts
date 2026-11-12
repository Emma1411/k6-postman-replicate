import path from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "workers/load-worker": "src/server/engine/workers/load-worker.ts" },
  outDir: "dist",
  format: ["cjs"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  // Tout est embarqué (undici, zod…) : le fichier fonctionne sans node_modules, y compris dans l'image Docker.
  noExternal: [/.*/],
  esbuildOptions(options) {
    // "server-only" lève une erreur hors de Next.js : on le remplace par un module vide.
    options.alias = { ...options.alias, "server-only": path.resolve("tests/stubs/server-only.ts") };
  },
});