'use client';
import { useState, useEffect } from 'react';
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

// ENV
const BICONOMY_API_KEY = process.env.NEXT_PUBLIC_BICONOMY_API_KEY || "";
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || "") as `0x${string}`;

if (!BICONOMY_API_KEY) {
  throw new Error("NEXT_PUBLIC_BICONOMY_API_KEY missing in .env");
}
if (!SPENDER || SPENDER === "0x") {
  throw new Error("NEXT_PUBLIC_SPENDER missing in .env");
}

// Tokens for each chain
const TOKENS_BY_CHAIN: Record<
  number,
  { symbol: string; address: `0x${string}`; decimals: number; min: bigint }[]
> = {
  // Optimism Mainnet
  [optimism.id]: [
    {
      symbol: "USDC",
      address: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
      decimals: 6,
      min: BigInt(1e6),
    },
  ],

  // Base Mainnet
  [base.id]: [
    {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54BDA02913",
      decimals: 6,
      min: BigInt(1e6),
    },
  ],

  // Ethereum Mainnet
  [mainnet.id]: [
    {
      symbol: "USDC",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      decimals: 6,
      min: BigInt(1e6),
    },
  ],

  // Sepolia Testnet (example USDC – replace with correct faucet token)
  [sepolia.id]: [
    {
      symbol: "USDC",
      address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      decimals: 6,
      min: BigInt(1e6),
    },
  ],
};

export default function Page() {
  const { address, chainId, isConnected } = useAccount();
  const [tokens, setTokens] = useState<typeof TOKENS_BY_CHAIN[number]>([]);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    setTokens(chainId && TOKENS_BY_CHAIN[chainId] ? TOKENS_BY_CHAIN[chainId] : []);
  }, [chainId]);

  const handleApprove = async (token: typeof tokens[number]) => {
    if (!address || !chainId) return;

    try {
      setStatus(`Checking allowance for ${token.symbol}...`);
      const allowance = (await readContract(config, {
        address: token.address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, SPENDER],
      })) as bigint;

      if (allowance >= token.min) {
        setStatus(`${token.symbol} already approved ✅`);
        return;
      }

      setStatus(`Building Fusion approval for ${token.symbol}...`);

      // Fusion-ready account (Companion Smart Account)
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

      // Instruction for approval
      const instruction = await orchestrator.buildComposable({
        type: 'default',
        data: {
          abi: erc20Abi,
          chainId,
          to: token.address,
          functionName: 'approve',
          args: [SPENDER, maxUint256],
        },
      });

      // Fusion quote
      const fusionQuote = await meeClient.getFusionQuote({
        instructions: [instruction],
        trigger: {
          chainId,
          tokenAddress: token.address,
          amount: token.min,
        },
        feeToken: {
          address: token.address,
          chainId,
        },
      });

      // Execute Fusion quote
      setStatus(`Executing gasless approval for ${token.symbol}...`);
      const { hash } = await meeClient.executeFusionQuote({ fusionQuote });
      await meeClient.waitForSupertransactionReceipt({ hash });

      setStatus(`Approval successful! Tx: ${hash}`);
    } catch (err: any) {
      console.error(err);
      setStatus(`Error: ${err.message || err}`);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Gasless Token Approval (Fusion)</h1>
      {!isConnected ? (
        <p>Please connect your wallet.</p>
      ) : (
        <>
          {tokens.length === 0 ? (
            <p>No supported tokens on this chain.</p>
          ) : (
            tokens.map((t, i) => (
              <div key={i} className="mb-2">
                <button
                  onClick={() => handleApprove(t)}
                  className="bg-green-600 text-white px-4 py-2 rounded"
                >
                  Approve {t.symbol}
                </button>
              </div>
            ))
          )}
          {status && <div className="mt-4 p-3 bg-gray-100 rounded">{status}</div>}
        </>
      )}
    </div>
  );
}
