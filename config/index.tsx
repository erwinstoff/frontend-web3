import { cookieStorage, createStorage } from '@wagmi/core'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, sepolia, arbitrum } from '@reown/appkit/networks'

// ✅ WalletConnect projectId
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID
if (!projectId) {
  throw new Error('WalletConnect projectId is not defined')
}

// Supported chains
export const networks = [mainnet, sepolia, arbitrum]

// ✅ Wagmi adapter setup
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId,
  networks,
})

// Export wagmi config
export const config = wagmiAdapter.wagmiConfig

// ✅ Token lists (per chain)
export const TOKENS_BY_CHAIN: Record<number, { address: string; symbol: string; decimals: number }[]> = {
  [mainnet.id]: [
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
  ],
  [arbitrum.id]: [
    { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC', decimals: 6 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6 },
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', decimals: 18 },
    { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', decimals: 18 },
    { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC', decimals: 8 },
  ],
  [sepolia.id]: [
    { address: '0x1234567890abcdef1234567890abcdef12345678', symbol: 'USDC', decimals: 6 }, // dummy
  ],
}

// ✅ Chain helpers
export const CHAIN_NAMES: Record<number, string> = {
  [mainnet.id]: 'Ethereum Mainnet',
  [arbitrum.id]: 'Arbitrum One',
  [sepolia.id]: 'Sepolia',
}

export const CHAIN_BY_ID: Record<number, any> = {
  [mainnet.id]: mainnet,
  [arbitrum.id]: arbitrum,
  [sepolia.id]: sepolia,
}

// Export wagmi config
export const config = wagmiAdapter.wagmiConfig
