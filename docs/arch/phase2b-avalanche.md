# SLA-DEX Phase 2B Avalanche Signing Design

> updated 2026-10-31 · 34122fa

## Intent

Deliver bilateral, cryptographically verifiable agreement approval and Fuji-compatible registry anchoring in the existing SLA-DEX Live Workspace. Organizations already registered in SLA-DEX are the parties; a display name alone never establishes participation. The chain proves that two designated EOA wallets approved the same frozen version, while confidential SLA terms stay off-chain.

## Goals

- Invite an existing organization, and let only its OWNER or ADMIN accept or reject.
- Freeze a canonical agreement snapshot and bind both verified signer wallets before signature collection.
- Verify typed-data signatures in the API and again in the registry contract.
- Persist transaction intent and reconcile durable backend state against contract state.
- Show actual invitation, wallet, signature, pending, confirmed, failed, and verification states in Live Workspace.
- Keep Phase 1 demo routes and Phase 2A draft APIs working.

## Non-goals

Oracle checks, monitoring, disputes, evidence, escrow, payments, penalties, settlement, reputation, marketplace, and legal identity or legal-signature certification are excluded. Contract-wallet (ERC-1271) signatures are excluded from this EOA-only MVP.

## Constraints

- Work from `c9622cf9581fd53378d7582b6c4b76e93806cef0` on `feat/unihack-phase2b-avalanche`.
- Keep PostgreSQL/Prisma, NestJS 12, Next.js 16 and React 19; Solidity compiler EVM target is `cancun`.
- Fuji chain ID is 43113. CI and ordinary tests use isolated PostgreSQL and a local EVM only.
- No Fuji deployment or production key use without separate approval and securely supplied local credentials.
- Preserve the Phase 2A initial migration and existing immutable version rows.

## Approaches

1. **Permissionless signature-validated registry with a relayer (selected).** Each wallet signs the exact snapshot and domain, anyone may submit both signatures, and the backend relayer pays gas. Contract checks both recovered signers and one-time version key. Durable database intents plus read-before-submit reconciliation make relayer retries safe. This satisfies gasless user flow without granting the backend signing authority.
2. **Owner/relayer-authorized registry.** Easier to operate but makes the operator a trusted signer and permits registration without bilateral consent; rejected because it contradicts the security requirement.
3. **Direct wallet transaction.** Avoids backend nonce/recovery work, but requires both users to fund gas and does not fit the requested relayed gasless flow; rejected.

## Identity and authorization

The owner invites an existing organization by ID through an authenticated endpoint. The ID is resolved server-side and never treated as proof by itself. The invitation binds agreement, current version, invited organization, inviter organization and expiry. Only a member of that invited organization with OWNER or ADMIN role can accept/reject. Agreement reads are allowed only to the owner organization and an accepted participant organization.

For this release, a CUSTOMER is the Buyer and a PROVIDER is the Supplier. The pair must contain exactly one of each; OTHER organizations cannot enter a bilateral SLA signing flow. This follows the existing organization taxonomy and is a product constraint, not legal identity verification.

Each organization OWNER/ADMIN can link their own EOA wallet after signing a short-lived typed wallet-link challenge. The record binds organization, user and address. A MEMBER cannot register a signer, accept an invitation, prepare a snapshot or submit a signature. The signing snapshot chooses one verified signer wallet per party; changing a wallet after freeze requires amendment and a new snapshot.

## Lifecycle and persistence

Business agreement status: `DRAFT`, `AWAITING_COUNTERPARTY`, `AWAITING_SIGNATURES`, `ANCHOR_PENDING`, `ANCHOR_CONFIRMED`, `ANCHOR_FAILED`, `REJECTED`, `CANCELLED`.

Signature collection status: `NOT_STARTED`, `PENDING`, `PARTIAL`, `COMPLETE`, `INVALIDATED`.

Blockchain transaction status: `NOT_QUEUED`, `QUEUED`, `SUBMISSION_UNCERTAIN`, `SUBMITTED`, `CONFIRMED`, `FAILED`, `REPLACED`, `RECONCILIATION_REQUIRED`.

An invitation transition is transactional and version-scoped. Acceptance locks a candidate version. Preparation creates one immutable snapshot with the participant IDs, selected wallets, canonical payload/hash, EIP-712 domain and validity deadline. Signatures are unique per snapshot and party, checked against the authorized signer and snapshot. Once both are valid, a unique durable registration intent is created in the same database transaction and the agreement moves to `ANCHOR_PENDING`. A database worker leases queued intents and serializes nonce allocation for the single relayer account. It verifies registry bytecode and the contract's EIP-712 name, version, chain ID and verifying address before submission. The worker signs locally, then commits the transaction chain ID, relayer address, nonce, raw signed transaction and derived hash before broadcasting those exact bytes.

### Transaction recovery

| State | Evidence | Worker action |
|---|---|---|
| Not submitted (`QUEUED`) | No signed transaction or nonce is stored | Read registry and verify contract domain; prepare and persist one signed transaction before broadcast |
| Submission uncertain (`SUBMISSION_UNCERTAIN`) | Signed bytes and their hash are durable, but RPC acknowledgement may be missing | Read registry, then check receipt and transaction by the stored hash; never allocate a new nonce |
| Pending (`SUBMITTED` / `REPLACED`) | Matching transaction is visible or its receipt is not yet available | Keep the same operation leased for later receipt checks; if a replacement hash is known, validate its sender, nonce, destination and calldata |
| Confirmed (`CONFIRMED`) | Valid owned transaction, canonical successful receipt at configured inclusive depth, exact registry data | Worker atomically confirms only the current frozen version under a valid database lease |
| Failed (`FAILED`) | A canonical reverted receipt at configured depth with no registration, or a definitive pre-broadcast rejection | A reverted or nonce-consuming transaction is not resent; an RPC-rejected operation may be retried only with the same stored transaction |
| Already registered | Registry matches but trusted transaction proof is absent | Require manual reconciliation without allocating a nonce or broadcasting; an owned hash with unavailable receipt remains pending |
| Manual intervention (`RECONCILIATION_REQUIRED`) | Registry conflicts, persisted transaction integrity fails, RPC uses a different domain, or the relayer nonce is consumed without the expected record | Stop automatic writes and retain the reason for operator investigation |

RPC timeouts are treated as uncertain, not as proof of rejection. If the original transaction is missing but its nonce remains unused, the worker rebroadcasts the same signed bytes and requires the RPC-returned hash to equal the stored hash. If the nonce is pending but not yet mined and the original hash is absent, the worker keeps the intent `SUBMISSION_UNCERTAIN`; it does not assume which same-nonce replacement is pending or allocate a new nonce. If the nonce has been mined and the expected registry entry is absent, the worker searches the latest 128 blocks for a transaction from the relayer at that nonce. A discovered different hash is persisted as `REPLACED` and its receipt is checked on the next pass; if no matching transaction can be identified and the registry is absent, the intent stops for `RECONCILIATION_REQUIRED`. A matching record with an owned missing receipt remains uncertain. Database uniqueness covers one intent per snapshot, one transaction hash, and one `(chain ID, relayer, nonce)` allocation. API retry reuses a stored transaction only after a definite RPC rejection; reverted and ambiguous operations cannot receive a new nonce through that endpoint. Receipt success alone is insufficient: the shared evaluator checks the exact approval calldata, canonical transaction/receipt identity and `evaluatedHead - receiptBlock + 1 >= BLOCKCHAIN_CONFIRMATIONS`, then compares registry version, hash, organizations and expiry at that same evaluated head and rechecks its hash. Both successful and reverted receipts require depth. Row locks, current version/frozen identity, per-claim ownership and PostgreSQL clock validity fence all worker state writes; agreement and intent updates commit atomically.

An amendment creates the next immutable AgreementVersion, invalidates signatures for the previous unanchored snapshot, withdraws its pending invitation state and restarts participation/signing. An already anchored snapshot is never mutated; an amendment is a new version key and new on-chain registration. State changes use conditional updates and database transactions. A receipt timeout retains the submitted hash and signed bytes for the next worker cycle. The worker does not infer a replacement transaction from a missing hash: an advanced relayer nonce without the expected registry record becomes `RECONCILIATION_REQUIRED`. Audit events record invitations, decisions, wallet linking, snapshots, signatures, cancellation, relayer attempts and reconciliation.

## Canonical snapshot and hash

Schema version `sla-dex-agreement-snapshot/1`. The canonical JSON object has a fixed documented key order and UTF-8 encoding, normalizes every string to Unicode NFC, trims only outer whitespace in human-entered fields, sorts exclusions by normalized UTF-8 byte order, encodes uptime as integer basis points (`99.95%` → `9995`), and uses decimal integer milliseconds/hours. Null notes are explicit `null`; missing material keys are invalid. Hash is `keccak256(UTF8(canonical JSON))`. No binary floats enter the protocol.

The snapshot binds schema version, agreement UUID/reference, version, buyer/supplier organization UUIDs, name, service description, all SLA terms, both signer addresses and expiry. The frontend renders these exact stored values before signing. The EIP-712 `AgreementApproval` struct additionally binds version-specific agreement key, snapshot hash, parties, signers, nonce and deadline under domain `SLA-DEX Agreement Registry`, protocol version `1`, chain ID and registry address. The version-specific key is `keccak256(abi.encode(keccak256(agreement UUID), uint64(version)))`; this lets an amendment be separately registered while keeping each version key unique.

## Contract and backend boundary

`AgreementRegistry` has no owner-only registration path. Its public registration function rejects zero/equal signers, expired authorization, duplicate version key and either invalid ECDSA signature. It stores the version-keyed snapshot hash, version, organization hashes, validity deadline and registration timestamp; signer addresses and signatures are visible in calldata. OpenZeppelin EIP712 and ECDSA utilities provide domain hashing/recovery, with low-s checks. EOA signatures are supported; ERC-1271 is explicitly unsupported.

The backend reads its RPC, chain ID, registry address, relayer private key and confirmation policy from validated environment configuration. It fails closed on missing/mismatched chain configuration. Secrets never leave the backend or appear in API responses. A persistent transaction intent is the source for retry; duplicate HTTP requests return existing state rather than creating another registry entry. The contract verifies the EOA addresses and signatures named in the approval; it cannot verify the SLA-DEX organization-to-signer authorization, which is enforced exclusively by the backend before the snapshot is signed. The verification API is read-only under every outcome. Worker and API share the [confirmation proof evaluator](../ref/agreement-confirmation.md); `verified` reports sufficient on-chain proof separately from the additive `durableConfirmed` database observation. Registry-only read-back cannot confirm.

## Frontend workflow

The Live Workspace presents participant identity, immutable version and terms, acceptance, signer wallet, two-party signature state, chain/RPC state, digest, tx hash and independently verified result. Wallet interaction uses EIP-1193 only and requires Fuji before signing; account/chain changes and user rejection update explicit UI state. The browser sends signatures over the authenticated API and never persists them in local storage. Demo Mode routes remain isolated from live API data.

## Failure and security model

Threats include a MEMBER attempting approval, an unrelated org probing private terms, forged/altered signatures, wallet substitution, wrong-chain or wrong-contract replay, stale snapshots, duplicate requests, public RPC outages, relayer balance exhaustion, pending/replaced/reverted transactions and a crash after inclusion. Server checks, role-scoped data access, wallet ownership proof, version-bound snapshots, EIP-712 domain separation, contract signature verification, unique constraints, an outbox/lease, idempotent read-before-retry and independent read-back mitigate these. A relayer can delay or censor submissions but cannot forge either party's approval. Public-chain metadata is not confidential; no SLA terms or personal data are stored on-chain.

## Quality and release

Contract unit tests, backend unit/integration tests, PostgreSQL migration-upgrade validation, frontend wallet/API behavior tests, TypeScript/lint/build/audit gates and the existing workflow are required. CI uses isolated PostgreSQL and a local EVM and never uses Fuji credentials. The added migration `20261026120000_reliable_anchor_submission` is forward-only; it adds transaction recovery fields and the uncertain status without rewriting earlier migrations. The repeatable upgrade check is `cd backend && npm run test:migration-upgrade`; it requires `TEST_DATABASE_URL` to identify an isolated database ending in `_test` and permission to create/drop a temporary sibling database. Only after all local gates pass, Fuji deployment, source verification and funded transaction remain separate, explicitly approved work. If a gate cannot run, report local validation as incomplete.

## Decision record

Decided: use permissionless, bilateral EIP-712 verification with a durable backend relayer · because it supports gasless users while keeping signing authority in party wallets · rejected an operator-authorized registry because it permits unilateral anchoring, and rejected direct transactions because it requires user gas · reopen if contract wallet signatures become an MVP requirement.

Decided: restrict parties to one CUSTOMER and one PROVIDER · because that is the existing domain taxonomy for Buyer and Supplier · rejected arbitrary `OTHER` pairing because party roles would become ambiguous · reopen if SLA-DEX adds explicit bilateral role selection.
