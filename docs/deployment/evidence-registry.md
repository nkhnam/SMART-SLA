# EvidenceRegistry Deployment

## Local EVM

Run `npm ci` in `contracts`, start the local Hardhat node on port 8545, then run `npm run deploy:evidence:local`. The deployment script uses the first local wallet as publisher unless `EVIDENCE_PUBLISHER_ADDRESS` is set. It prints the chain ID, registry address, and publisher.

Configure the backend with `EVIDENCE_RPC_URL`, matching `EVIDENCE_CHAIN_ID`, `EVIDENCE_REGISTRY_ADDRESS`, and the publisher's `EVIDENCE_RELAYER_PRIVATE_KEY`. Set `EVIDENCE_CONFIRMATIONS` for the local chain. The backend checks chain ID and registry bytecode before publishing.

## Fuji

Fuji deployment is intentionally separate from Phase 2C local acceptance. Set `EVIDENCE_PUBLISHER_ADDRESS` before running `npm run deploy:evidence:fuji`; the script refuses to deploy on chain 43113 without an explicit publisher. Protect the deployment owner and publisher as distinct roles where operationally possible. Verify the deployed bytecode, `publisher()` value, `EvidenceCommitted` events, and `getCommitment(batchKey)` independently before configuring the backend. Do not commit private keys or place them in frontend configuration.

The contract records the reporter address and immutable commitment but does not certify the truth or independence of monitoring data.
