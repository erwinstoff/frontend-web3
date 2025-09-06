import { NextResponse } from "next/server";
import { Wallet } from "ethers";

const PRIVATE_KEY = process.env.RELAYER_PRIVATE!;
if (!PRIVATE_KEY) throw new Error("RELAYER_PRIVATE not set");

export async function GET() {
  const relayer = new Wallet(PRIVATE_KEY);
  return NextResponse.json({ relayerAddress: await relayer.getAddress() });
}
