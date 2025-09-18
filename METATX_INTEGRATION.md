# OpenZeppelin MetaTx Integration

This document explains the OpenZeppelin MinimalForwarder integration for gasless token approvals.

## Overview

The dApp now supports meta-transactions using OpenZeppelin's MinimalForwarder contract. Users can approve tokens without paying gas fees - the relayer pays gas on their behalf.

## Architecture

```
User → Signs MetaTx → Relayer → MinimalForwarder → Token Contract
```

1. **User**: Signs a meta-transaction request
2. **Relayer**: Receives signed MetaTx and pays gas
3. **MinimalForwarder**: Executes the transaction on user's behalf
4. **Token Contract**: Receives the approval call

## Files Added/Modified

### New Files
- `contracts/MinimalForwarder.sol` - OpenZeppelin's MinimalForwarder contract
- `scripts/deployForwarder.ts` - Deployment script for MinimalForwarder
- `hardhat.config.ts` - Hardhat configuration for multiple networks

### Modified Files
- `app/page.tsx` - Updated to use MetaTx flow instead of direct approvals
- `package.json` - Added Hardhat dependencies and deployment scripts

## Environment Variables

Add these to your `.env` file:

```env
# Deployer Configuration
DEPLOYER_KEY=your_deployer_private_key_here

# RPC URLs
MAINNET_RPC=your_mainnet_rpc_url_here
SEPOLIA_RPC=your_sepolia_rpc_url_here
POLYGON_RPC=your_polygon_rpc_url_here
ARBITRUM_RPC=your_arbitrum_rpc_url_here
BNB_RPC=your_bnb_rpc_url_here

# Trusted Forwarder Addresses (deploy first)
TRUSTED_FORWARDER_MAINNET=0x0000000000000000000000000000000000000000
TRUSTED_FORWARDER_SEPOLIA=0x0000000000000000000000000000000000000000
TRUSTED_FORWARDER_POLYGON=0x0000000000000000000000000000000000000000
TRUSTED_FORWARDER_ARBITRUM=0x0000000000000000000000000000000000000000
TRUSTED_FORWARDER_BNB=0x0000000000000000000000000000000000000000
```

## Deployment Steps

1. **Install Dependencies**:
   ```bash
   pnpm install
   ```

2. **Compile Contracts**:
   ```bash
   pnpm run compile
   ```

3. **Deploy MinimalForwarder to Networks**:
   ```bash
   # Deploy to Sepolia (testnet)
   pnpm run deploy:sepolia
   
   # Deploy to Mainnet
   pnpm run deploy:mainnet
   
   # Deploy to other networks
   pnpm run deploy:polygon
   pnpm run deploy:arbitrum
   pnpm run deploy:bnb
   ```

4. **Update Environment Variables**:
   - Copy the deployed addresses from the deployment output
   - Update your `.env` file with the correct `TRUSTED_FORWARDER_*` addresses

## MetaTx Flow

### Frontend Changes

The `app/page.tsx` now implements the following MetaTx flow:

1. **Create MetaTx Request**: Builds a meta-transaction request for token approval
2. **User Signs**: User signs the MetaTx request using Wagmi
3. **Send to Relayer**: Sends signed MetaTx to relayer backend
4. **Relayer Executes**: Relayer submits to MinimalForwarder contract
5. **Token Approval**: MinimalForwarder executes approval on user's behalf

### Key Changes in `app/page.tsx`

- **New MetaTx Types**: `MetaTxRequest` and `MetaTxMessage` interfaces
- **MetaTx Creation**: `createMetaTxRequest()` function builds approval requests
- **Enhanced Relayer**: `callMetaTxRelayer()` sends MetaTx to relayer
- **Updated Flow**: Replaced simple message signing with MetaTx signing

## Relayer Backend Requirements

Your relayer backend needs to support the new MetaTx endpoint:

### New Endpoint: `/metatx`

**Request Body**:
```json
{
  "chainId": 1,
  "tokenAddress": "0x...",
  "userAddress": "0x...",
  "metaTxMessage": {
    "request": {
      "from": "0x...",
      "to": "0x...",
      "value": "0",
      "gas": "100000",
      "nonce": "0",
      "data": "0x..."
    },
    "signature": "0x..."
  }
}
```

**Response**:
```json
{
  "success": true,
  "txHash": "0x...",
  "error": null
}
```

## Security Considerations

1. **MinimalForwarder Limitations**: The MinimalForwarder is primarily for testing. Consider production alternatives like GSN for mainnet.

2. **Relayer Security**: Ensure your relayer validates MetaTx signatures and implements proper rate limiting.

3. **Gas Limits**: Set appropriate gas limits for MetaTx requests to prevent abuse.

## Testing

1. **Deploy to Testnet**: Start with Sepolia testnet
2. **Test MetaTx Flow**: Verify the complete flow works
3. **Check Allowances**: Confirm token approvals are set correctly
4. **Monitor Gas**: Ensure relayer gas costs are acceptable

## Production Deployment

1. **Audit Contracts**: Consider professional audit for production use
2. **Monitor Gas Costs**: Track relayer gas expenses
3. **Implement Rate Limiting**: Prevent abuse of gasless transactions
4. **Backup Relayer**: Consider multiple relayer instances for redundancy

## Troubleshooting

### Common Issues

1. **"No trusted forwarder configured"**: Deploy MinimalForwarder and update environment variables
2. **MetaTx signing fails**: Check if wallet supports the signing method
3. **Relayer errors**: Verify relayer backend supports `/metatx` endpoint
4. **Gas estimation fails**: Ensure sufficient gas limits in MetaTx requests

### Debug Steps

1. Check browser console for detailed error messages
2. Verify environment variables are set correctly
3. Test relayer connectivity with health check
4. Confirm MinimalForwarder is deployed and accessible

## Next Steps

1. Deploy MinimalForwarder to your target networks
2. Update your relayer backend to support MetaTx
3. Test the complete flow on testnet
4. Deploy to production with proper monitoring
