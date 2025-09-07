import { erc20Abi, encodeFunctionData, parseUnits } from "viem";
import { getMeeClient } from "@/utils/meeClient";

type SendMeeTxParams = {
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  amountHuman: string;
  approveAmountHuman?: string;
  decimals: number;
  chainId: number;
  address: string; // ✅ wallet address
};

export async function sendMeeTx({
  tokenAddress,
  spender,
  amountHuman,
  approveAmountHuman,
  decimals,
  chainId,
  address,
}: SendMeeTxParams) {
  const meeClient = await getMeeClient(chainId, address);

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

  const { quote } = await meeClient.getFusionQuote({
    trigger,
    instructions: [instruction],
    feeToken,
  });

  const { hash } = await meeClient.executeFusionQuote({ fusionQuote: quote });

  return hash as string;
}
