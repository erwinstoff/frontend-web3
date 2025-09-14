// config/smartWallet.ts
"use client";

import { createGelatoSmartWalletClient, sponsored } from "@gelatonetwork/smartwallet";
import { gelato } from "@gelatonetwork/smartwallet/accounts";
import { createWalletClient, createPublicClient, http, type Hex, type Address } from "viem";
import { mainnet, base, arbitrum, polygon } from "viem/chains";

const CHAIN_MAP = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  137: polygon,
} as const;

export class SmartWalletService {
  private smartWalletClient: any = null;
  private apiKey: string;
  private initialized = false;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async initializeSmartWallet(userAddress: Address, chainId: number = 1) {
    if (this.initialized && this.smartWalletClient) {
      return this.smartWalletClient;
    }

    try {
      const chain = CHAIN_MAP[chainId as keyof typeof CHAIN_MAP] || mainnet;
      
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      const account = await gelato({
        owner: { address: userAddress } as any,
        client: publicClient,
      });

      const client = createWalletClient({
        account,
        chain,
        transport: http()
      });

      this.smartWalletClient = createGelatoSmartWalletClient(client, { 
        apiKey: this.apiKey 
      });

      this.initialized = true;
      return this.smartWalletClient;
    } catch (error) {
      console.error('Failed to initialize smart wallet:', error);
      throw error;
    }
  }

  async executeSponsoredTransaction(
    to: Address,
    data: Hex,
    value: bigint = 0n
  ) {
    if (!this.smartWalletClient) {
      throw new Error('Smart wallet not initialized');
    }

    try {
      const results = await this.smartWalletClient.execute({
        payment: sponsored(),
        calls: [
          {
            to,
            data,
            value
          }
        ]
      });

      console.log("UserOp hash:", results?.id);
      const txHash = await results?.wait();
      console.log("Transaction hash:", txHash);
      
      return {
        userOpHash: results?.id,
        transactionHash: txHash
      };
    } catch (error) {
      console.error('Sponsored transaction failed:', error);
      throw error;
    }
  }

  reset() {
    this.smartWalletClient = null;
    this.initialized = false;
  }
}