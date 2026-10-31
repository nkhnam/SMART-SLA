# Agreement confirmation policy (Gate 4A.1)

`BLOCKCHAIN_CONFIRMATIONS` is enforced for both successful and reverted AgreementRegistry receipts. Inclusive depth is `evaluatedHead.number - receipt.blockNumber + 1`: a receipt at 100 with head 101 has depth 2 and remains pending when N=3. Extra depth is an application policy, not additional Avalanche consensus finality.

## Proof and ownership

`backend/src/blockchain/agreement-confirmation.ts` is the shared, side-effect-free evaluator for the worker and `verifyAgreement()`. It checks the frozen canonical snapshot and bilateral signatures, configured chain/registry/EIP-712 domain, original signed bytes/hash, sender/nonce/chain/destination/zero value/exact approval calldata, resolved transaction and receipt identities, canonical receipt block, configured depth and all registry fields. Domain/code and registry reads use one evaluated head number; its hash is rechecked before verdicts. The registry lookup uses the frozen agreement key. Contradictory or unavailable block snapshots never confirm.

Legacy RPC transaction responses can omit `chainId`. In that case the evaluator derives it from replay-protected EIP-155 signed `v` as `(v - 35) / 2` using integer division, matching viem's transaction parser. It never substitutes the configured chain ID for missing signed identity; unprotected or absent metadata still fails closed.

Only the worker writes durable `CONFIRMED`/`ANCHOR_CONFIRMED`. It locks the agreement, signing snapshot and intent in a PostgreSQL transaction, checks the exact current version and frozen identity, recoverable status, lease token and database-clock expiry, then updates both rows atomically. A failed second write rolls back the first. Preparation, broadcast admission, reconciliation and failure release use the same ownership boundary. API retry remains restricted to the existing safely retryable failed operations and locks the current agreement version.

The authenticated verification endpoint retains participant/organization checks and performs no database writes, including success, integrity conflict and RPC errors. `verified` means sufficient current on-chain proof; additive `durableConfirmed` reports the database state observed by that request. `proofStatus`, `reason`, `confirmations`, `requiredConfirmations`, `receiptBlock` and `evaluatedHead` explain the proof result. A concurrent worker may commit after the API's database read; an earlier `durableConfirmed: false` does not undo that commit. The existing frontend independently reloads durable anchor status after verification. Monitoring still requires both durable confirmed agreement and intent for the active signed version.

## Recovery states

| Observation | Result |
| --- | --- |
| Receipt missing, insufficient depth, RPC error or changing canonical snapshot | Keep the existing recoverable state and identity; release the lease for later worker evaluation. |
| Canonical successful receipt at depth N and exact registry record | Atomically confirm the intent and current agreement version. |
| Canonical reverted receipt at depth N with no registration | Atomically fail. Existing deterministic pre-broadcast validation/RPC rejection handling remains separate. |
| Reverted receipt with another registration, conflicting record, or invalid original/replacement identity | Reconciliation; never invent success or revert failure from contradictory evidence. |
| Matching external record without trusted transaction identity (policy X, R10) | Reconciliation with null transaction hash/nonce/bytes; no transaction preparation or duplicate broadcast. |
| Matching record with owned hash but missing receipt | Remain uncertain. This is not classified as an external registration. |

A missing original transaction can trigger the existing bounded 128-block sender/nonce replacement search, including when the registry already matches. A discovered replacement is stored only in `replacementHash` and independently checked for chain, sender, nonce, destination, value, exact calldata, receipt and depth. The original `signedTransaction`, `transactionHash` and `relayerNonce` remain unchanged. A registry match never authorizes rebroadcast. When registry and transaction are absent and the nonce is unused, recovery rebroadcasts only the original bytes; waiting for depth never allocates another nonce or signature.

## Reproduce

From `backend/`, run `npm run test:unit` and `npm run typecheck:anchor-integration`. `npm run test:anchor-integration` requires a dedicated `_test` PostgreSQL database and a deployed loopback Hardhat registry on chain 31337 with `DATABASE_URL`, `ANCHOR_TEST_RPC_URL`, `ANCHOR_TEST_CHAIN_ID`, `ANCHOR_TEST_REGISTRY_ADDRESS` and the public local-fixture `ANCHOR_TEST_RELAYER_PRIVATE_KEY`. Use the existing `.github/workflows/phase2a.yml` service/deployment setup; never supply public-chain credentials. The existing workflow runs the complete integration file, including N=3 and R10.

The N=3 integration test emits `N3_BLOCK_EVIDENCE` with actual H/H+1/H+2, depth, persisted status, transaction hash and nonce. It checks API nonmutation, restart, two-worker contention, one registry event and the monitoring boundary. Other cases cover receipt faults, noncanonical blocks, head changes, valid/invalid replacements, lease expiry/takeover, changed agreement version, API held across worker confirmation and PostgreSQL rollback between the two finalization writes.

## Limits

An RPC is trusted to report truthful chain data; canonical hash cross-checks do not authenticate a malicious provider. Deep reorgs after durable confirmation are not automatically rolled back. Gate 4A.1 does not discover external registration transactions or provide a reconciliation UI/automatic importer. An owned missing receipt remains recoverable; an external record without trusted proof requires operator investigation. An orphaned tracked replacement or one outside the bounded scan may need manual reconciliation. Database/chain writes cannot be made globally atomic, so persisted original identity and canonical reevaluation remain necessary after process loss. No Solidity or schema changes are required. Fuji role custody/funding/gas budgets (N2) and a separately approved deployment/verification window (N3) remain NO-GO prerequisites.
