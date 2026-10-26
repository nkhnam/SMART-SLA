# SLA-DEX Phase 2B Avalanche Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and locally verify organization-scoped bilateral EIP-712 approval and Avalanche Fuji-ready agreement anchoring.

**Architecture:** PostgreSQL stores invitation, participant, wallet authorization, immutable signing snapshot, signatures and a durable anchor outbox. NestJS validates organization membership, wallet proof and signatures, while a relayer submits only two-party-approved registrations to a permissionless OpenZeppelin EIP-712 registry. The Live Workspace renders actual lifecycle and wallet state; all CI blockchain activity uses local EVM.

**Tech Stack:** NestJS 12, Prisma 7, PostgreSQL, Next.js 16, React 19, Solidity 0.8.x, Hardhat 3, OpenZeppelin Contracts 5.x, viem, Node.js 24.

**Spec:** `docs/arch/phase2b-avalanche.md`; originating requirements are in the Phase 2B request pasted in this task.

## Global Constraints

- Branch `feat/unihack-phase2b-avalanche` starts at `c9622cf9581fd53378d7582b6c4b76e93806cef0`.
- Fuji chain ID is 43113 and Solidity `evmVersion` is `cancun`.
- Preserve Phase 1 demo flows, Phase 2A endpoints and the Phase 2A initial migration.
- Never put private keys/mnemonics in source, frontend or CI secrets; CI must not call Fuji.
- Contract registration requires both expected EOA signatures; ERC-1271 is unsupported and documented.
- Store no SLA text or personal information on-chain; confirm only after independent state read-back.
- Do not implement monitoring, oracle, dispute, escrow, settlement, token or marketplace behavior.
- No deploy, push, merge or tag; only coherent local commits on the requested feature branch.

## Review Focus

- A MEMBER or unrelated organization attempts to read terms, accept an invite, link a wallet or sign; every server path must deny it.
- Unicode-equivalent strings, reordered exclusions, null notes and decimal uptime produce one canonical digest; any material change produces another.
- A signature is replayed across another agreement/version, chain, registry or deadline; API and contract reject it.
- The relayer crashes after transaction inclusion or the DB update fails; retry reconciles the already registered exact record without creating another.
- An amendment happens after one or both signatures; old signatures and invitations cannot authorize the new version.

---

### Task 1: Protocol types and canonical hashing

**Files:** `backend/src/blockchain/agreement-hash.service.ts`, corresponding unit test and test scripts; `docs/protocol/agreement-hashing.md`.

**Interfaces:** Export typed `AgreementSnapshotInput`, `CanonicalAgreementSnapshot`, `canonicalizeAgreementSnapshot(input)`, `hashAgreementSnapshot(snapshot)`, `agreementKey(agreementId, version)` and `agreementApprovalTypedData(snapshot, chainId, registryAddress, nonce, deadline)`.

- [ ] Add tests for identical inputs, NFC normalization, exclusion order, integer basis points, and every material field changing the digest.
- [ ] Run the focused tests and observe expected failure.
- [ ] Implement canonical schema v1, fixed field order, UTF-8 keccak256, version key and EIP-712 domain/message.
- [ ] Run focused tests and backend typecheck.
- [ ] Document byte-level normalization, field order, hash and typed message with fixtures.
- [ ] Commit the protocol unit.

### Task 2: Database state and migrations

**Files:** `backend/prisma/schema.prisma`, a new timestamped migration, generated Prisma client, schema tests.

**Interfaces:** Enums `AgreementStatus`, `SignatureCollectionStatus`, `AnchorTransactionStatus`; models `AgreementInvitation`, `AgreementParticipant`, `AuthorizedSigner`, `SigningSnapshot`, `AgreementSignature`, `AnchorIntent` with uniqueness/FK/index rules in the design doc.

- [ ] Test fresh database migration, existing DRAFT row readability and uniqueness constraints.
- [ ] Run schema validation and observe the new migration/test failure before implementation.
- [ ] Add lifecycle enums and normalized relation models; do not rewrite the Phase 2A migration.
- [ ] Apply migrations to isolated fresh PostgreSQL and typecheck generated client.
- [ ] Commit schema and migration.

### Task 3: Bilateral invitation, acceptance, wallet proof and lifecycle APIs

**Files:** `backend/src/agreements/**`, `backend/src/blockchain/**`, modules, DTOs and integration tests.

**Interfaces:** Invitation `POST /agreements/:id/invitations`; accept/reject under invitation ID; authenticated invitation inbox for the selected org; wallet challenge/verify routes; prepare-signing, signing read, signature submission, anchor read/retry and verification routes as the originating request specifies.

- [ ] Add integration cases for accepted organization isolation, MEMBER denial, invalid invitation scope/expiry, wallet challenge replay, immutable snapshot, amendment invalidation and audit trail; run to establish failure.
- [ ] Implement organization-scoped authorization, CUSTOMER/PROVIDER party selection, explicit states, optimistic version checks and transactional audit writes.
- [ ] Implement wallet ownership challenge, snapshot freeze, expiry and EIP-712 server signature recovery; reject wrong wallet, wrong org, wrong version and replay.
- [ ] Run backend unit and PostgreSQL integration suites, lint, typecheck and build.
- [ ] Commit invitation/signing API layer.

### Task 4: Registry contract and local signing tests

**Files:** `contracts/contracts/AgreementRegistry.sol`, `contracts/hardhat.config.ts`, `contracts/package.json`, tests and local deployment scripts.

**Interfaces:** Permissionless `registerAgreement(AgreementApproval, buyerSignature, supplierSignature)`, `getAgreement(agreementKey)`, registration event and domain `SLA-DEX Agreement Registry` version `1`; Hardhat local chain and Fuji network config with chain 43113 and Cancun compiler target.

- [ ] Test two-signature success, altered/invalid signature, expiry, chain/contract domain mismatch, duplicate/version replay and exact event/read-back; run to establish failure.
- [ ] Implement OpenZeppelin `EIP712` and `ECDSA` verification and privacy-minimal immutable registry state.
- [ ] Compile and run all contract tests on local Hardhat network.
- [ ] Commit contract workspace.

### Task 5: Durable relayer and reconciliation

**Files:** blockchain configuration/module/client/worker/anchoring/reconciliation services, env schema/example, backend integration tests.

**Interfaces:** Validated chain config, `queueRegistration(snapshotId)`, `processPendingIntents()`, `reconcileIntent(intentId)`, and `verifyAgreement(agreementId)`.

- [ ] Add local-EVM integration tests for idempotent requests, wrong network, reverted tx, low balance, duplicate transaction, crash-after-inclusion recovery and DB/on-chain mismatch; run to establish failure.
- [ ] Implement persisted intent leasing, serialized relayer nonce submission, receipt/replacement tracking, retry classification and independent registry read-back.
- [ ] Ensure missing/mismatched config degrades visibly and never reports confirmation; never return credentials.
- [ ] Run backend unit/integration, typecheck, lint, build and local-EVM tests.
- [ ] Commit relayer and recovery layer.

### Task 6: Live Workspace workflow

**Files:** `frontend/lib/live-api.ts`, agreement detail and workspace components/routes, frontend wallet/signing tests.

**Interfaces:** Typed API calls for invitation, signing, wallet proof, anchor status and verification; EIP-1193 provider abstraction for connect, chain switch, account/network events and EIP-712 signing.

- [ ] Add adapter/component tests for connected, rejected, disconnected, wrong-chain, signature submitted/rejected, real backend errors, no demo fallback and pending/confirmed states; run to establish failure.
- [ ] Implement participant/status/timeline views, immutable term confirmation, Fuji wallet flow and authenticated signature submission; do not persist signatures in local storage.
- [ ] Read applicable Next.js 16.4.3 docs from installed `node_modules/next/dist/docs/` before changing frontend source.
- [ ] Run API tests, lint, TypeScript checks, Webpack build, smoke test and dependency audits.
- [ ] Add browser automation only if it runs against local EVM and does not compromise CI secrets; report only executed coverage.
- [ ] Commit frontend flow.

### Task 7: CI, documentation and release validation

**Files:** `.github/workflows/phase2a.yml` or a focused Phase 2B workflow, architecture/security/deployment docs, README, CHANGELOG, docs index.

- [ ] Add CI steps for contract compile/tests, local EVM integration, fresh PostgreSQL migration and all existing Phase 2A checks; preserve its branch trigger.
- [ ] Run the full local gate and dependency audits; fix failures at source.
- [ ] Document state transitions, threat model, hashes, Fuji secrets/funding/deploy/read-back; clarify no Fuji run occurred without explicit approval.
- [ ] Update README and `[Unreleased]` changelog; run repository release lint if available.
- [ ] Run final status/diff and security review against the five Review Focus cases.
- [ ] Commit documentation and CI; leave branch unpushed and unmerged.

### Task 8: Final verification and report

- [ ] Re-read the full Phase 2B request and account for every deliverable.
- [ ] Run complete required gates and record actual outputs.
- [ ] Perform author self-review (no delegated coding/review agent per request).
- [ ] Report SHA, commits, migration, interface/security decisions, endpoints, UI, tests, CI evidence, Fuji status and remaining blockers.
