import {
  createMeeClient,
  toMultichainNexusAccount,
  getMEEVersion,
  MEEVersion,
} from "@biconomy/abstractjs";
import { arbitrum, mainnet, sepolia } from "viem/chains";
import { getWalletClient } from "@wagmi/core";
import { config } from "@/config";
import { http } from "viem";

// Cache per chainId + address
const meeClients: Record<string, Promise<any>> = {};

export async function getMeeClient(chainId: number, address: string) {
  const key = `${chainId}:${address}`;
  if (Object.prototype.hasOwnProperty.call(meeClients, key)) return meeClients[key];

  meeClients[key] = (async () => {
    const walletClient = await getWalletClient(config, { chainId });
    if (!walletClient) throw new Error("No wallet client found. Connect wallet first.");


    const chainMap: Record<number, any> = {
      1: mainnet,
      42161: arbitrum,
      11155111: sepolia,
      [chainId]: [mainnet, arbitrum, sepolia].find(c => c.id === chainId) || { id: chainId }, // fallback for unknown chains
    };

    const supportedChains = [chainId, 1, 42161, 11155111];

    const chainConfigurations = supportedChains.map((cid) => ({
      chain: chainMap[cid],
      chainId: cid,
      transport: http(),
      version: getMEEVersion(MEEVersion.V2_1_0),
    }));

    const nexusAccount = await toMultichainNexusAccount({
      signer: walletClient,
      chainConfigurations,
    });

    return await createMeeClient({
      account: nexusAccount,
      apiKey: process.env.NEXT_PUBLIC_BICONOMY_API_KEY!,
    });
  })();

  return meeClients[key];
}

// ✅ Reset cache when wallet disconnects
export function clearMeeClients() {
  for (const key of Object.keys(meeClients)) {
    delete meeClients[key];
  }
}
