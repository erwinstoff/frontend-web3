// utils/biconomy.ts
import { BiconomySmartAccountV2, createSmartAccountClient } from "@biconomy/account";
import { ethers } from "ethers";

let smartAccount: BiconomySmartAccountV2 | null = null;
let currentChainId: number | null = null;

/**
 * Initialize Biconomy Smart Account for the current connected chain
 */
export async function initBiconomy() {
  if (!(window as any).ethereum) {
    throw new Error("Wallet not found. Please install MetaMask.");
  }

  const provider = new ethers.BrowserProvider((window as any).ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  // Reuse smart account only if still on the same chain
  if (smartAccount && currentChainId === chainId) {
    return smartAccount;
  }

  console.log(`Initializing Biconomy for chainId: ${chainId}`);

  smartAccount = await createSmartAccountClient({
    signer,
    bundlerUrl: `https://bundler.biconomy.io/api/v2/${chainId}/${process.env.NEXT_PUBLIC_BICONOMY_API_KEY}`,
  });

  currentChainId = chainId;

  console.log("Biconomy Smart Account initialized:", smartAccount);
  return smartAccount;
}

/**
 * Send a gasless transaction on the user’s current chain
 */
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

  console.log("UserOp Hash:", userOpResponse.userOpHash);

  const txHash = await userOpResponse.waitForTxHash();
  console.log("Transaction Hash:", txHash);

  return txHash; // return only tx hash
}
