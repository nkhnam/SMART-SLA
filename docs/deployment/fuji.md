# Avalanche Fuji deployment

> updated 2026-10-26 · 797b78e

Fuji deployment is a manual, separately approved testnet operation. No Fuji deployment has been performed for this implementation. Local contract compilation and tests do not prove a public testnet deployment.

## Prerequisites

- Node.js 24 and `npm ci` in `contracts/`.
- A dedicated testnet EOA with enough Fuji AVAX for deployment; do not use a production wallet.
- A trusted Fuji C-Chain RPC endpoint.
- Store the RPC URL and deployer private key in a local ignored `.env` file or approved secret manager. Never paste keys into chat, commit them, expose them to frontend code or configure a CI deployment secret.

The contract workspace `.env.example` names `AVALANCHE_FUJI_RPC_URL` and `AVALANCHE_FUJI_DEPLOYER_PRIVATE_KEY`. The Hardhat network is configured for chain ID `43113`, and Solidity targets Cancun.

## Deploy and verify

From `contracts/`, load the two environment variables securely and run:

```powershell
npm ci
npm run compile
npm run deploy:fuji
```

The deployment script prints the connected chain ID and registry address. Stop if the chain ID is not `43113`; do not retry by changing the network or using a mainnet key. Record the real deployment transaction hash from the wallet/RPC output and the resulting address in the release record only after independently checking them.

Verify the deployed source with the supported Avalanche explorer tooling when available, then read the deployed registry address and chain ID from an independent RPC/explorer. The registry has no confidential SLA content; its stored signer addresses, version keys and hashes are public.

## End-to-end test

After an explicitly approved funded deployment, use two separate test wallets belonging to the two organizations. Have each wallet review and sign the exact frozen snapshot through the authenticated application. Submit through the backend relayer, wait for a successful receipt, then read the registry state independently and compare key, version, digest and both signer addresses. Preserve only real transaction and explorer links. If RPC, funding, wallet approval or permissions are unavailable, report the deployment as pending; never manufacture an address or success result.

## Local validation

Ordinary development and CI use Hardhat's local EVM:

```powershell
npm ci
npm run compile
npm test
npm run deploy:local
```

These commands require no Fuji funding and must never submit a public-network transaction.
