'use client'

// 1. First, update your ContextProvider.tsx to include Gelato
import { wagmiAdapter, projectId } from '@/config'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit } from '@reown/appkit/react'
import { mainnet, arbitrum, sepolia } from '@reown/appkit/networks'
import React, { type ReactNode } from 'react'
import { cookieToInitialState, WagmiProvider, type Config } from 'wagmi'
import { GelatoSmartWalletProvider } from '@gelatonetwork/smartwallet-react-wagmi'

// Setup query client
const queryClient = new QueryClient()

if (!projectId) {
  throw new Error('WalletConnect projectId is not defined')
}

// ✅ Metadata must match your deployed domain
const metadata = {
  name: 'AIRDROPS',
  description: 'CLAIM MULTIPLE TOKEN',
  url: 'https://frontend-web3.vercel.app', // must exactly match your deployed domain
  icons: ['https://frontend-web3.vercel.app/icon.png'],
}

// ✅ Create modal that works for ALL wallets
createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [mainnet, sepolia, arbitrum],
  defaultNetwork: mainnet,
  metadata,
  features: {
    analytics: true,
    socials: false,     // disables socials
    email: false,       // disables email login
    emailShowWallets: true // shows wallets first instead of email
  },
  allWallets: "SHOW"
})

function ContextProvider({
  children,
  cookies,
}: {
  children: ReactNode
  cookies: string | null
}) {
  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies
  )

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
    >
      <QueryClientProvider client={queryClient}>
        {/* Add Gelato Smart Wallet Provider */}
        <GelatoSmartWalletProvider 
          apiKey={process.env.NEXT_PUBLIC_GELATO_API_KEY!}
        >
          {children}
        </GelatoSmartWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default ContextProvider