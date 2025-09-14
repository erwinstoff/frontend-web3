// components/SponsoredApproval.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { parseUnits, encodeFunctionData, type Address } from 'viem';
import { SmartWalletService } from '../config/smartWallet';

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

interface SponsoredApprovalProps {
  tokenAddress: Address;
  spenderAddress: Address;
  amount: string;
  decimals: number;
}

export function SponsoredApproval({ 
  tokenAddress, 
  spenderAddress, 
  amount, 
  decimals 
}: SponsoredApprovalProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [smartWalletService, setSmartWalletService] = useState<SmartWalletService | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState(false);

  const gelatoApiKey = process.env.NEXT_PUBLIC_GELATO_API_KEY;

  // Initialize service when user connects
  useEffect(() => {
    if (address && gelatoApiKey && isConnected) {
      const service = new SmartWalletService(gelatoApiKey);
      setSmartWalletService(service);
      setIsInitialized(false);
    } else {
      setSmartWalletService(null);
      setIsInitialized(false);
    }
  }, [address, gelatoApiKey, isConnected]);

  const handleApproval = async () => {
    if (!isConnected || !address) {
      alert('Please connect your wallet');
      return;
    }

    if (!smartWalletService || !gelatoApiKey) {
      alert('Smart wallet service not available');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Initialize smart wallet if needed
      if (!isInitialized) {
        await smartWalletService.initializeSmartWallet(address, chainId);
        setIsInitialized(true);
      }

      const parsedAmount = parseUnits(amount, decimals);

      // Encode the function call
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spenderAddress, parsedAmount],
      });

      // Execute sponsored transaction
      const result = await smartWalletService.executeSponsoredTransaction(
        tokenAddress,
        data,
        0n
      );

      setTxHash(result.transactionHash);
      alert(`Success! Transaction hash: ${result.transactionHash}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      setError(errorMessage);
      alert(`Error: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg border">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Gasless Token Approval</h2>
      
      <div className="space-y-4">
        <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
          <div className="text-sm">
            <span className="font-medium text-gray-600">Token:</span>
            <div className="font-mono text-xs text-gray-800 break-all mt-1">{tokenAddress}</div>
          </div>
          <div className="text-sm">
            <span className="font-medium text-gray-600">Spender:</span>
            <div className="font-mono text-xs text-gray-800 break-all mt-1">{spenderAddress}</div>
          </div>
          <div className="text-sm">
            <span className="font-medium text-gray-600">Amount:</span>
            <span className="ml-2 text-gray-800">{amount}</span>
          </div>
          <div className="text-sm">
            <span className="font-medium text-gray-600">Status:</span>
            <span className={`ml-2 ${isInitialized ? 'text-green-600' : 'text-yellow-600'}`}>
              {isInitialized ? '✅ Ready' : '⏳ Initializing...'}
            </span>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
            <p className="text-sm">{error}</p>
          </div>
        )}

        {txHash && (
          <div className="p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg">
            <p className="text-sm font-medium">Success!</p>
            <p className="text-xs font-mono break-all mt-1">Tx: {txHash}</p>
          </div>
        )}

        <button
          onClick={handleApproval}
          disabled={isLoading || !isConnected}
          className="w-full flex justify-center items-center px-4 py-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
              Processing...
            </div>
          ) : (
            'Approve (No Gas Required!)'
          )}
        </button>

        <div className="text-center">
          <div className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-blue-50 to-green-50 border border-blue-200 rounded-full">
            <span className="text-sm text-blue-700">
              ✨ Gas fees sponsored - no ETH required!
            </span>
          </div>
        </div>

        {!isConnected && (
          <div className="text-center p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-700">Please connect your wallet to continue</p>
          </div>
        )}
      </div>
    </div>
  );
}