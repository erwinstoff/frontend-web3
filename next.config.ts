import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Exclude modules in Webpack
  webpack: (config) => {
    config.externals?.push("pino-pretty", "lokijs", "encoding");
    return config;
  },

  // Exclude in Turbopack by aliasing to mock
  experimental: {
    turbo: {
      resolveAlias: {
        "pino-pretty": path.resolve(__dirname, "./mock.js"),
        "lokijs": path.resolve(__dirname, "./mock.js"),
        "encoding": path.resolve(__dirname, "./mock.js"),
      },
    },
  },

  // Ensure server-only modules aren’t bundled for the client
  serverExternalPackages: ['pino-pretty', 'encoding'],
};

export default nextConfig;