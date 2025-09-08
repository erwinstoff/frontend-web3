import { erc20Abi, encodeFunctionData, parseUnits } from "viem";
import { getMeeClient } from "@/utils/meeClient";

type SendMeeTxParams = {
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  amountHuman: string;
  approveAmountHuman?: string;
  decimals: number;
  chainId: number;
};

export async function sendMeeTx({
  tokenAddress,
  spender,
  amountHuman,
  approveAmountHuman,
  decimals,
  chainId,
}: SendMeeTxParams) {
  const meeClient = await getMeeClient(chainId, spender);

  const triggerAmount = parseUnits(amountHuman, decimals);
  const approveAmount = approveAmountHuman
    ? parseUnits(approveAmountHuman, decimals)
    : BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, approveAmount],
  });

  const instruction = {
    chainId,
    calls: [{ to: tokenAddress, data: approveData }],
  };

  const trigger = { chainId, tokenAddress, amount: triggerAmount };
  const feeToken = { address: tokenAddress, chainId };

  // ✅ Pre-check: supported as Fusion fee token?
  const supported = await meeClient.isFeeTokenSupported({ chainId, tokenAddress });
  if (!supported) {
    throw new Error(`Token ${tokenAddress} is not supported as a Fusion fee token on chain ${chainId}`);
  }

  try {
    const { quote } = await meeClient.getFusionQuote({
      trigger,
      instructions: [instruction],
      feeToken,
    });

    const { hash } = await meeClient.executeFusionQuote({ fusionQuote: quote });

    return hash as string;
  } catch (err: any) {
    // 🟢 EDITED: Improved error logging
    console.error("Fusion execution failed (raw):", err);

    const msg =
      err?.shortMessage ||
      err?.message ||
      (typeof err === "object" ? JSON.stringify(err) : String(err));

    throw new Error(`Fusion approval failed: ${msg}`);
  }
}
