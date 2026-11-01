# EvidenceRegistry deployment

Fuji preparation and the shared GO/NO-GO checklist live in the [Fuji preflight runbook](fuji.md). Gate 4A sends no transactions. No Fuji address, receipt or ownership verification is claimed.

## Local EVM

From `contracts/`, `npm run deploy:evidence:local` creates an ephemeral simulated chain; its registry does not persist on an already running node. To configure a backend against a persistent local node, start it with `npx hardhat node --network hardhatMainnet --hostname 127.0.0.1`, then use another contracts shell to set the intended public `EVIDENCE_PUBLISHER_ADDRESS` and run `npx hardhat run scripts/deploy-evidence.ts --network localEvm`.

The local script defaults to its deployer as publisher only when no public publisher is set. It verifies chain 31337, a successful deployment receipt, owner and publisher, and preserves the existing `{chainId, registryAddress, publisher}` JSON consumed by CI. Known local accounts are public fixtures, never funded Fuji roles.

Configure backend `EVIDENCE_RPC_URL`, matching `EVIDENCE_CHAIN_ID`, actual `EVIDENCE_REGISTRY_ADDRESS` and separate `EVIDENCE_RELAYER_PRIVATE_KEY` together. Set `EVIDENCE_CONFIRMATIONS` explicitly. This activates the worker and can send transactions; do not supply live keys during public-network preflight.

## Fuji roles and authorization

The deployment owner, agreement relayer, evidence publisher and both party signers must be distinct. Both scripts require actual chain 43113, the public roles from `contracts/.env.example`, a matching deployer identity and `FUJI_DEPLOYMENT_APPROVED=43113` in a separately approved session. Fuji construction always uses explicit `EVIDENCE_PUBLISHER_ADDRESS`; zero or reused role addresses fail before broadcast.

`owner()` is the deployer permanently: no ownership-transfer function exists. Only this owner can call `setPublisher(nonzeroAddress)`. Only `publisher()` can commit. Backend key-derived publisher identity must match before a new operation; historical reporter identity remains valid after rotation. Organization/source/version authorization and measurement truth remain off-chain; this registry does not call AgreementRegistry or certify an independent oracle.

## Read-only verification and recovery

Run `npm run compile`, `npm run typecheck`, `npm test` and keyless `npm run preflight:fuji`. After separate approved deployment, supply both actual registry addresses and rerun preflight to check exact evidence runtime, owner/publisher and the agreement artifact/domain. Independently verify deployment receipt/source with the pinned compiler and constructor; the read-only script does not establish them.

Later approved batch publication requires a successful canonical receipt at `EVIDENCE_CONFIRMATIONS` depth and full `getCommitment(batchKey)` comparison: version key/version, root, batch digest, schema hash, window and historical reporter. Export verification proves integrity, not truth. Follow [Gate 3B diagnostics](../ref/evidence-publisher-reliability.md) for uncertain sends, same-byte retry, rotation and nonce conflicts; retain durable signed bytes and never create an ad hoc replacement operation.

Rotation is a separately approved funded transaction. Commitments cannot be edited/rolled back; lost owner custody prevents rotation. No proxy upgrade, pause, deletion, owner transfer or automatic contract rollback exists. Follow [runbook recovery limits](fuji.md#recovery-and-rollback-limitations) before restarting workers, restoring a database or changing domains.
