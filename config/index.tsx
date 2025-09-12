// src/config/index.tsx
import { cookieStorage, createStorage } from '@wagmi/core';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { mainnet, sepolia, arbitrum } from '@reown/appkit/networks';
import { http, fallback } from 'viem';

// WalletConnect projectId (required)
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;
if (!projectId) throw new Error('NEXT_PUBLIC_PROJECT_ID is not defined');

// Supported chains
export const networks = [mainnet, sepolia, arbitrum];

// Wagmi adapter (unchanged)
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId,
  networks,
});

export const config = wagmiAdapter.wagmiConfig;

// RPC keys (set in env)
const INFURA_ID = process.env.NEXT_PUBLIC_INFURA_ID || '';
const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_KEY || '';

// Transports used by AbstractJS / viem — MUST be defined or AbstractJS will fail
export const transports: Record<number, ReturnType<typeof fallback> | ReturnType<typeof http>> = {
  [mainnet.id]: fallback([
    http(`https://mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
  [arbitrum.id]: fallback([
    http(`https://arb-mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
  [sepolia.id]: fallback([
    http(`https://sepolia.infura.io/v3/${INFURA_ID}`),
    http(`https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
};

// Token lists per chain — addresses typed for TS safety
export const TOKENS_BY_CHAIN: Record<
  number,
  { address: `0x${string}`; symbol: string; decimals: number }[]
> = {
  [mainnet.id]: [
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`, symbol: 'USDC', decimals: 6 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as `0x${string}`, symbol: 'USDT', decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' as `0x${string}`, symbol: 'DAI', decimals: 18 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as `0x${string}`, symbol: 'WETH', decimals: 18 },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as `0x${string}`, symbol: 'WBTC', decimals: 8 },
  ],
  [arbitrum.id]: [
    { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8' as `0x${string}`, symbol: 'USDC', decimals: 6 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as `0x${string}`, symbol: 'USDT', decimals: 6 },
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1' as `0x${string}`, symbol: 'DAI', decimals: 18 },
    { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' as `0x${string}`, symbol: 'WETH', decimals: 18 },
    { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f' as `0x${string}`, symbol: 'WBTC', decimals: 8 },
  ],
  [sepolia.id]: [
    // Dummy/test token — replace with real test addresses
    { address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`, symbol: 'USDC', decimals: 6 },
  ],
};

// Chain name helpers
export const CHAIN_NAMES: Record<number, string> = {
  [mainnet.id]: 'Ethereum Mainnet',
  [arbitrum.id]: 'Arbitrum One',
  [sepolia.id]: 'Sepolia',
};

// Chain by id mapping for AbstractJS chainConfigurations
export const CHAIN_BY_ID: Record<number, any> = {
  [mainnet.id]: mainnet,
  [arbitrum.id]: arbitrum,
  [sepolia.id]: sepolia,
};