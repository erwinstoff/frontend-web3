// app/page.tsx
"use client";

import { SponsoredApproval } from '../components/SponsoredApproval';

export default function Home() {
  // Example token addresses - you can change these to your actual tokens
  const USDC_ADDRESS = "0xA0b86a33E6441e58f62C72eb5A72cc22edFF3E9D"; // USDC on mainnet
  const SPENDER_ADDRESS = "0x1234567890123456789012345678901234567890"; // Replace with your contract

  return (
    <main className="min-h-screen bg-gray-100 py-12">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Gasless Token Approvals
          </h1>
          <p className="text-gray-600">
            Approve tokens without paying gas fees using Gelato
          </p>
        </div>

        <SponsoredApproval
          tokenAddress={USDC_ADDRESS}
          spenderAddress={SPENDER_ADDRESS}
          amount="100"
          decimals={6}
        />
      </div>
    </main>
  );
}