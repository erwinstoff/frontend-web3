import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbo: {
      resolveAlias: {
        "pino-pretty": false, // ⬅️ exclude from browser bundle
      },
    },
  },
};

export default nextConfig;
