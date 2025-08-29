import { cookieStorage, createStorage } from '@wagmi/core'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, sepolia, arbitrum } from '@reown/appkit/networks'

// ✅ Use your real WalletConnect projectId
// Make sure it's also set in Vercel as NEXT_PUBLIC_PROJECT_ID
export const projectId =
  process.env.NEXT_PUBLIC_PROJECT_ID;

if (!projectId) {
  throw new Error('WalletConnect projectId is not defined')
}

// Supported chains
export const networks = [mainnet, sepolia, arbitrum]

// ✅ Wagmi adapter setup
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
})

// Export wagmi config
export const config = wagmiAdapter.wagmiConfig
