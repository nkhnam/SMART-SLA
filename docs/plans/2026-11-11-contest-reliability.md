# Contest Reliability Implementation Plan

> Execute this plan in this session with independent code review before delivery.

**Goal:** Repair reproducible SLA signing, monitoring and local onboarding defects, and prepare an honest submission guide for the Avalanche competition.

**Architecture:** Preserve the existing NestJS/PostgreSQL, Next.js and Avalanche registry boundaries. Repair the current workflows with focused behavioral regressions; use isolated test databases and local EVMs. Deployment with real funds and production publication are separate from local repair.

**Tech Stack:** Next.js 16, React 19, NestJS 12, Prisma 7, PostgreSQL 17, Hardhat 3, Solidity, Node.js.

## Assumptions and constraints

- The existing Phase 2C branch is the current project; preserve the clean original checkout and all existing functionality.
- Prioritize reproducible bugs and a judge-readable demo over speculative product expansion.
- Local correctness, tenant boundaries, deterministic evidence and repeatable startup are the acceptance criteria.
- No customer traction, live outages, deployment, payout or arbitration capability may be invented.
- The organizer FAQ is the working source for the earlier deadline: 23:59 21 November 2026, Vietnam time.

## Task 1: Establish baseline

1. Install lockfile dependencies in frontend, backend and contracts in the isolated checkout.
2. Run frontend lint, typecheck, API tests, build and production smoke.
3. Run backend lint, generation, typecheck, unit tests and build.
4. Run contracts compile, typecheck and tests on a local EVM.
5. Start only a separate test PostgreSQL service, then run relevant integration and browser checks. Record actual failures and environmental limitations.

## Task 2: Repair monitoring correctness

**Files:** backend/src/monitoring/kpi-engine.ts, monitoring-kpi.service.ts, monitoring-source.service.ts, monitoring-evidence.service.ts; backend/test/unit/monitoring-kpi.test.ts; relevant backend/test/integration fixtures.

1. Add a failing regression for signed webhook timestamps that do not align exactly with source creation milliseconds. Establish a deterministic one-observation-per-slot rule before selecting the smallest repair.
2. Reproduce evaluation reruns with late observations; assert the persisted and returned result match the observations used for breach decisions.
3. Reproduce delayed probe timestamps at evaluation boundaries; assert the selected scheduled-slot records reproduce all persisted KPI metrics before export. Original historical input IDs are not stored; the portable verifier establishes integrity and inclusion, not independent numerical KPI replay.
4. Implement each minimal repair independently, rerun its regression and the existing monitoring tests.
5. Exercise signed webhook ingestion, evaluation and evidence export together against the isolated database.

## Task 3: Enforce bilateral signer freeze

**Files:** backend/src/blockchain/authorized-signers.service.ts and backend/test/integration/api.integration.test.ts.

1. Reproduce a counterparty organization revoking the authorized signer bound to an active immutable snapshot.
2. Apply the existing frozen-snapshot rule to both signer references, rather than the agreement owner only.
3. Verify owner and counterparty revocations are blocked while the snapshot is active, and unrelated signers can still be revoked.

## Task 4: Repair local and live UI usability

**Files:** frontend/.gitignore, frontend/.env.example, frontend/components/workspace/workspace-shell.tsx, agreement-detail.tsx, relevant frontend/tests/e2e specs, README.md.

1. Restore the tracked public API configuration example and validate the README commands against a fresh checkout.
2. Expose the current organization ID where users can find and copy it for invitations.
3. Keep the agreed SLA terms readable after signing and confirmation; retain frozen-snapshot provenance and version context.
4. Read installed Next.js documentation before changes. Verify browser behavior and responsive layout with meaningful assertions for the repaired flows.

## Task 5: Submission preparation and review

1. Document the official rubric, required links, 2–3 minute demo sequence, current technical scope and verified limitations in docs/competition/.
2. Provide a truthful Fuji readiness checklist; do not represent a local EVM as Avalanche deployment.
3. Review the final diff independently. Resolve important findings and run all relevant checks once after integration.
4. Transfer only reviewed changes back to D:/code/Shadow-Byte on a dedicated local branch; preserve the original branch and do not push without user direction.

## Task 6: Prevent public registry key poisoning

**Files:** contracts/contracts/AgreementRegistry.sol, contract tests, deployment/preview/preflight scripts, backend acceptance launcher and signing/deployment documentation.

1. Reproduce an unauthorized signer pair registering a known agreement key before its legitimate submission.
2. Restrict registration to an authorized publisher using the existing registry role pattern; retain bilateral EIP-712 verification and the runtime registration ABI.
3. Update constructor arguments and public role validation consistently in local fixtures, deployment, preview and preflight. Do not broadcast transactions.
4. Verify an unauthorized caller cannot occupy a key, an authorized publisher can register valid bilateral approvals, and role separation remains enforced.

## Validation record

See [the dated validation record](../competition/validation-2026-11-11.md) for actual commands, results and limitations. Frontend build/API/HTTP/browser checks, backend build/lint/118 unit cases, 26 contract cases, 5 PostgreSQL API cases, 27 anchor recovery cases and two fresh full-stack acceptance runs passed. Frontend lint passed on all 10 changed code files; the whole-frontend lint run was stopped under host memory pressure.

An additional configuration review found that fixed local-development/test database credentials were published on all host interfaces. Both Compose bindings were restricted to `127.0.0.1` and their normalized configuration was checked. Fuji Compose was already loopback-only.

Read-only Fuji preflight returned `NO_GO` because the configured deployer was unfunded; relayers also had zero test AVAX. Anonymous repository access returned HTTP 404. Real Fuji deployment, secure runtime provisioning, judge access and hosted checks remain separate submission prerequisites. No push, user-secret-key loading or public-network transaction was performed. Isolated EVM tests used public test-only keys.
