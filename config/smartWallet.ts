// config/smartWallet.ts
"use client";

import { createGelatoSmartWalletClient, sponsored } from "@gelatonetwork/smartwallet";
import { gelato } from "@gelatonetwork/smartwallet/accounts";
import { createWalletClient, createPublicClient, http, type Hex, type Address } from "viem";
import { mainnet, base, arbitrum, polygon, sepolia } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const CHAIN_MAP = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  137: polygon,
  11155111: sepolia,
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
      
      console.log('Initializing smart wallet for chain:', chain.name);
      
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      // For demo purposes, we'll create a temporary private key
      // In production, you'd handle this more securely
      const privateKey = generatePrivateKey();
      const owner = privateKeyToAccount(privateKey);

      console.log('Creating gelato account...');
      
      const account = await gelato({
        owner,
        client: publicClient,
      });

      console.log('Account created:', account.address);

      const client = createWalletClient({
        account,
        chain,
        transport: http()
      });

      console.log('Creating smart wallet client with API key...');
      
      // IMPORTANT: Await the smart wallet client creation
      const smartWalletClient = await createGelatoSmartWalletClient(client, { 
        apiKey: this.apiKey 
      });

      // Make sure we actually got a client back
      if (!smartWalletClient) {
        throw new Error('Failed to create smart wallet client');
      }

      this.smartWalletClient = smartWalletClient;

      console.log('Smart wallet client created:', !!this.smartWalletClient);
      console.log('Execute function exists:', !!this.smartWalletClient?.execute);
      console.log('Smart wallet client type:', typeof this.smartWalletClient);
      console.log('Smart wallet client methods:', Object.getOwnPropertyNames(this.smartWalletClient));

      this.initialized = true;
      return this.smartWalletClient;
    } catch (error) {
      console.error('Failed to initialize smart wallet:', error);
      this.initialized = false;
      this.smartWalletClient = null;
      throw new Error(`Smart wallet initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

    // Additional check to make sure it's not a promise
    if (this.smartWalletClient instanceof Promise) {
      console.error('Smart wallet client is still a Promise!');
      throw new Error('Smart wallet client was not properly awaited during initialization');
    }

    if (typeof this.smartWalletClient.execute !== 'function') {
      console.error('Smart wallet client:', this.smartWalletClient);
      console.error('Smart wallet client type:', typeof this.smartWalletClient);
      console.error('Available methods:', Object.getOwnPropertyNames(this.smartWalletClient));
      throw new Error('Smart wallet client execute method is not available');
    }

    try {
      console.log('Executing sponsored transaction...');
      console.log('To:', to);
      console.log('Data:', data);
      console.log('Value:', value.toString());

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
      throw new Error(`Sponsored transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  reset() {
    this.smartWalletClient = null;
    this.initialized = false;
  }
}