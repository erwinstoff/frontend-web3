// utils/biconomy.ts
import { BiconomySmartAccountV2, createSmartAccountClient } from "@biconomy/account";
import { ethers } from "ethers";
import { getWalletClient } from "@wagmi/core";
import { config } from "@/config";

let smartAccount: BiconomySmartAccountV2 | null = null;
let currentChainId: number | null = null;

export async function initBiconomy() {
  const walletClient = await getWalletClient(config);
  if (!walletClient) throw new Error("No wallet connected. Please connect first.");

  // Wrap wagmi's transport into an ethers provider
  const provider = new ethers.BrowserProvider(walletClient.transport);
  const signer = await provider.getSigner();

  const { chain } = walletClient;
  const chainId = Number(chain?.id);

  // Reuse existing smart account if still on the same chain
  if (smartAccount && currentChainId === chainId) {
    return smartAccount;
  }

  console.log(`🔄 Initializing Biconomy (MEE stack) for chainId: ${chainId}`);

  smartAccount = await createSmartAccountClient({
    signer,
    bundlerUrl: `https://bundler.biconomy.io/api/v2/${chainId}/${process.env.NEXT_PUBLIC_BICONOMY_API_KEY}`,
    biconomyPaymasterApiKey: process.env.NEXT_PUBLIC_BICONOMY_API_KEY, // 👈 required for gasless
  });

  currentChainId = chainId;

  console.log("✅ Biconomy Smart Account initialized:", smartAccount);
  return smartAccount;
}

export async function sendGaslessTx(tx: {
  to: string;
  data: string;
  value?: string;
}) {
  const account = await initBiconomy();
  if (!account) throw new Error("Biconomy account not initialized");

  const userOpResponse = await account.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value || "0",
  });

  console.log("📝 UserOp Hash:", userOpResponse.userOpHash);

  const txHash = await userOpResponse.waitForTxHash();
  console.log("✅ Transaction Hash:", txHash);

  return txHash;
}
