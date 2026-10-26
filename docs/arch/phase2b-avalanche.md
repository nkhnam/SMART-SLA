# SLA-DEX Phase 2B Avalanche Signing Design

> updated 2026-10-26 · ce30fce

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

Blockchain transaction status: `NOT_QUEUED`, `QUEUED`, `SUBMITTED`, `CONFIRMED`, `FAILED`, `REPLACED`, `RECONCILIATION_REQUIRED`.

An invitation transition is transactional and version-scoped. Acceptance locks a candidate version. Preparation creates one immutable snapshot with the participant IDs, selected wallets, canonical payload/hash, EIP-712 domain and validity deadline. Signatures are unique per snapshot and party, checked against the authorized signer and snapshot. Once both are valid, a unique durable registration intent is created in the same database transaction and the agreement moves to `ANCHOR_PENDING`. A database worker leases queued intents and serializes submissions for the single relayer account. Before retrying, it reads the registry; an existing matching record is reconciled as success, while a mismatched record is a security failure. Receipt success alone is insufficient: the backend independently reads and compares the registered agreement key, version, hash and signers before setting `ANCHOR_CONFIRMED`.

An amendment creates the next immutable AgreementVersion, invalidates signatures for the previous unanchored snapshot, withdraws its pending invitation state and restarts participation/signing. An already anchored snapshot is never mutated; an amendment is a new version key and new on-chain registration. State changes use conditional updates and database transactions. A receipt timeout retains the submitted hash so the worker resumes receipt tracking instead of submitting a duplicate; viem replacement detection stores the replacement hash and the replacement receipt still must pass the same registry read-back. Audit events record invitations, decisions, wallet linking, snapshots, signatures, cancellation, relayer attempts and reconciliation.

## Canonical snapshot and hash

Schema version `sla-dex-agreement-snapshot/1`. The canonical JSON object has a fixed documented key order and UTF-8 encoding, normalizes every string to Unicode NFC, trims only outer whitespace in human-entered fields, sorts exclusions by normalized UTF-8 byte order, encodes uptime as integer basis points (`99.95%` → `9995`), and uses decimal integer milliseconds/hours. Null notes are explicit `null`; missing material keys are invalid. Hash is `keccak256(UTF8(canonical JSON))`. No binary floats enter the protocol.

The snapshot binds schema version, agreement UUID/reference, version, buyer/supplier organization UUIDs, name, service description, all SLA terms, both signer addresses and expiry. The frontend renders these exact stored values before signing. The EIP-712 `AgreementApproval` struct additionally binds version-specific agreement key, snapshot hash, parties, signers, nonce and deadline under domain `SLA-DEX Agreement Registry`, protocol version `1`, chain ID and registry address. The version-specific key is `keccak256(abi.encode(keccak256(agreement UUID), uint64(version)))`; this lets an amendment be separately registered while keeping each version key unique.

## Contract and backend boundary

`AgreementRegistry` has no owner-only registration path. Its public registration function rejects zero/equal signers, expired authorization, duplicate version key and either invalid ECDSA signature. It stores only the key, version, snapshot hash, two signer addresses and registration timestamp; it emits the same indexed identity plus digest. OpenZeppelin EIP712 and ECDSA utilities provide domain hashing/recovery, with low-s checks. EOA signatures are supported; ERC-1271 is explicitly unsupported.

The backend reads its RPC, chain ID, registry address, relayer private key and confirmation policy from validated environment configuration. It fails closed on missing/mismatched chain configuration. Secrets never leave the backend or appear in API responses. A persistent transaction intent is the source for retry; duplicate HTTP requests return existing state rather than creating another registry entry. No API can mark an agreement confirmed without RPC read-back.

## Frontend workflow

The Live Workspace presents participant identity, immutable version and terms, acceptance, signer wallet, two-party signature state, chain/RPC state, digest, tx hash and independently verified result. Wallet interaction uses EIP-1193 only and requires Fuji before signing; account/chain changes and user rejection update explicit UI state. The browser sends signatures over the authenticated API and never persists them in local storage. Demo Mode routes remain isolated from live API data.

## Failure and security model

Threats include a MEMBER attempting approval, an unrelated org probing private terms, forged/altered signatures, wallet substitution, wrong-chain or wrong-contract replay, stale snapshots, duplicate requests, public RPC outages, relayer balance exhaustion, pending/replaced/reverted transactions and a crash after inclusion. Server checks, role-scoped data access, wallet ownership proof, version-bound snapshots, EIP-712 domain separation, contract signature verification, unique constraints, an outbox/lease, idempotent read-before-retry and independent read-back mitigate these. A relayer can delay or censor submissions but cannot forge either party's approval. Public-chain metadata is not confidential; no SLA terms or personal data are stored on-chain.

## Quality and release

Contract unit tests, backend unit/integration tests, migration-on-fresh-PostgreSQL validation, frontend wallet/API behavior tests, TypeScript/lint/build/audit gates and the existing Phase 2A workflow are required. CI starts a deterministic local EVM and never uses Fuji credentials. Only after all local gates pass, Fuji deployment, source verification and funded transaction remain separate, explicitly approved work and the truthful status is `LOCAL IMPLEMENTATION PASS — FUJI DEPLOYMENT PENDING`. If a local gate cannot run, report local validation as incomplete instead.

## Decision record

Decided: use permissionless, bilateral EIP-712 verification with a durable backend relayer · because it supports gasless users while keeping signing authority in party wallets · rejected an operator-authorized registry because it permits unilateral anchoring, and rejected direct transactions because it requires user gas · reopen if contract wallet signatures become an MVP requirement.

Decided: restrict parties to one CUSTOMER and one PROVIDER · because that is the existing domain taxonomy for Buyer and Supplier · rejected arbitrary `OTHER` pairing because party roles would become ambiguous · reopen if SLA-DEX adds explicit bilateral role selection.
