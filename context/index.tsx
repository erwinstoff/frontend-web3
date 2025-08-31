'use client'

import { wagmiAdapter, projectId } from '@/config'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit } from '@reown/appkit/react'
import { mainnet, arbitrum, sepolia } from '@reown/appkit/networks'
import React, { type ReactNode } from 'react'
import { cookieToInitialState, WagmiProvider, type Config } from 'wagmi'

// Setup query client
const queryClient = new QueryClient()

if (!projectId) {
  throw new Error('WalletConnect projectId is not defined')
}

// ✅ Metadata must match your deployed domain
const metadata = {
  name: 'Frontend Web3 App',
  description: 'Multi-wallet dApp built with Reown + Wagmi',
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
    social: true 
    email: false  
  },
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
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}

export default ContextProvider
