import type { NextConfig } from "next";

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  
  // Image optimization
  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 31536000, // 1 year
  },
  
  // Bundle optimization
  webpack: (config, { isServer, dev }) => {
    // External dependencies for server-side rendering
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    
    // Optimize bundle splitting
    if (!isServer && !dev) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          // Separate vendor chunks
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
            priority: 10,
          },
          // Separate Web3 libraries
          web3: {
            test: /[\\/]node_modules[\\/](@wagmi|wagmi|viem|ethers|@reown|@biconomy|@gelatonetwork|@base-org)[\\/]/,
            name: 'web3',
            chunks: 'all',
            priority: 20,
          },
          // Separate React Query
          reactQuery: {
            test: /[\\/]node_modules[\\/](@tanstack)[\\/]/,
            name: 'react-query',
            chunks: 'all',
            priority: 15,
          },
        },
      };
    }
    
    return config;
  },
  
  // Experimental features for performance
  experimental: {
    optimizePackageImports: ['@reown/appkit', '@tanstack/react-query', 'viem'],
  },
  
  // Turbopack configuration
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  
  // Headers for caching and security
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
      {
        source: '/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);