import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,

  serverExternalPackages: ["worker_threads"],

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;