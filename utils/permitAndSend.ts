"use client";

import type { Eip1193Provider } from "ethers";
import { BrowserProvider, Contract, parseUnits, MaxUint256 } from "ethers";
import erc20Abi from "@/abi/ERC20.json";

export async function signPermit({
  chain,
  tokenAddress,
  owner,
  spender,
  amountHuman,
}: {
  chain: "sepolia" | "eth" | "polygon" | "arbitrum" | "bnb";
  tokenAddress: string;
  owner: string;
  spender: string;
  amountHuman: string;
}) {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    throw new Error("No injected wallet found (MetaMask, Coinbase, etc.)");
  }

  const provider = new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
  const signer = await provider.getSigner();
  const token = new Contract(tokenAddress, erc20Abi, signer);

  const [decimalsRaw, name, nonceBN, network] = await Promise.all([
    token.decimals(),
    token.name(),
    token.nonces(owner),
    provider.getNetwork(),
  ]);
  const decimals = Number(decimalsRaw);
  const nonce = nonceBN.toString();
  const chainId = Number(network.chainId);

  const value = amountHuman === "max"
    ? MaxUint256.toString()
    : parseUnits(amountHuman, decimals).toString();

  const deadline = Math.floor(Date.now() / 1000) + 3600;

  const domain = {
    name,
    version: "1",
    chainId,
    verifyingContract: tokenAddress,
  };

  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const message = {
    owner,
    spender,
    value,
    nonce,
    deadline,
  };

  const signature = await signer.signTypedData(domain, types, message);

  const resp = await fetch("/api/meta-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chain,
      tokenAddress,
      owner,
      spender,
      value,
      deadline,
      signature,
      skipTransfer: true
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Relayer error: " + text);
  }

  return resp.json();
}
