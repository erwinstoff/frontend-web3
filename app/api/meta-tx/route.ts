import { NextResponse } from "next/server";
import { JsonRpcProvider, Wallet, Signature, Contract } from "ethers";
import erc20Abi from "@/abi/ERC20.json";

const PRIVATE_KEY = process.env.RELAYER_PRIVATE!;
if (!PRIVATE_KEY) throw new Error("RELAYER_PRIVATE not set");

const RPCS: Record<string, string> = {
  eth: process.env.RPC_ETH!,
  polygon: process.env.RPC_POLYGON!,
  arbitrum: process.env.RPC_ARBITRUM!,
  bnb: process.env.RPC_BNB!,
  sepolia: process.env.RPC_SEPOLIA!,
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { chain, tokenAddress, owner, spender, value, deadline, signature, skipTransfer } = body;

    if (!chain || !RPCS[chain]) return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
    if (!tokenAddress || !owner || !spender || !value || !deadline || !signature) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const provider = new JsonRpcProvider(RPCS[chain]);
    const relayer = new Wallet(PRIVATE_KEY, provider);
    const sig = Signature.from(signature);
    const token = new Contract(tokenAddress, erc20Abi, relayer);

    // call permit only
    const permitTx = await token.permit(owner, spender, value, deadline, sig.v, sig.r, sig.s);
    const permitReceipt = await permitTx.wait();

    return NextResponse.json({
      ok: true,
      chain,
      permitTxHash: permitReceipt.transactionHash ?? permitReceipt.hash ?? permitTx.hash
    });
  } catch (err: any) {
    console.error("meta-tx error:", err);
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
