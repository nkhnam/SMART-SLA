# Phase 2C Oracle Monitoring and Evidence Plan

**Goal:** Collect organization-authorized measurements for a confirmed immutable SLA version, calculate deterministic KPI results, and export independently verifiable evidence committed to a local Avalanche-compatible EVM.

**Architecture:** Extend the existing NestJS/Prisma API with organization-scoped sources, durable poll leases, authenticated webhooks, append-only observations, deterministic evaluations, and canonical evidence packages. Use a separate append-only `EvidenceRegistry` and a separately configured evidence publisher account so Phase 2B's bilateral registry and nonce allocator remain unchanged. Add the workflow to the existing Next.js Live Workspace while keeping fixture-backed Demo Mode visibly separate.

**Baseline:** `origin/main` at `daa50e1bc49f2a4cee8582af069caf849ab5044d`, which contains Phase 2B tip `7ba164e2ea11026f0de1ea1b5afb3d79f64ecd07`. Work is on `feat/unihack-phase2c-oracle-evidence`.

**Decisions:** An observation is permanently bound to one agreement version and source. Missing samples remain unknown; they never become healthy or failed samples. Uptime uses healthy / (healthy + failed) only when observed-sample coverage reaches the documented minimum; otherwise it is `INSUFFICIENT_DATA`. Latency uses arithmetic mean because the current signed SLA has a response-time target but no percentile. Free-text exclusions never affect calculation. Evidence commitments contain only a batch root and public metadata. Hash verification proves integrity relative to that commitment, not measurement truth.

## Slices

1. Audit current signing, authorization, API, UI, migrations, CI and local-EVM flows; establish the existing checks and Phase 2B hosted CI state.
2. Add forward-only Prisma models and constraints for version-bound sources, leased polling runs, append-only observations/evaluations, breach candidates, evidence batches and anchor intents.
3. Add OWNER/ADMIN source configuration requiring two accepted parties, a frozen snapshot, bilateral signatures and `ANCHOR_CONFIRMED` status; enforce bounded intervals, source quotas, endpoint validation and encrypted webhook secrets.
4. Implement pinned-address HTTP probing with DNS/redirect validation, timeout and body limits, plus raw-body HMAC webhooks with freshness, nonce, replay, ownership, size and rate controls.
5. Add a deterministic KPI engine with explicit coverage, missing-data, latency, source-disagreement and non-adjudicative breach states; test boundaries and exclusions.
6. Define canonical evidence serialization, observation digests, a Merkle tree and inclusion proofs; export a package that a standalone verifier can validate without the API.
7. Add a separately authorized `EvidenceRegistry`, durable database-backed anchor recovery and local-EVM tests; preserve the existing `AgreementRegistry` and relayer nonce policy.
8. Add Live Workspace monitoring, source management, KPI comparison, observation timeline, breach review, evidence export and verification states; keep Demo Mode isolated.
9. Add deterministic local fixture/service demonstration, security/integration/E2E coverage at 375, 768 and 1440 pixels, CI checks, documentation and release report.

## Acceptance checks

- Authenticated users cannot configure or read sources outside a participating organization; only OWNER/ADMIN can configure them.
- Monitoring requires the exact active version to be bilaterally signed and confirmed on the configured network.
- HTTP sources reject private, loopback, link-local, reserved, metadata and rebound destinations; redirects are revalidated.
- Webhooks validate raw-body HMAC in constant time and reject stale, oversized, replayed, duplicated or cross-organization events.
- Durable leases prevent duplicate workers and resume after restart; failures do not terminate the backend.
- Missing observations yield unknown/insufficient data; KPI outputs and evidence hashes are deterministic.
- Tampering invalidates hashes/proofs; local EVM anchors are authorized, unique, immutable and readable independently.
- The Live Workspace distinguishes operator probes, provider reports, synthetic tests and fixture-only demo data.
- Existing Phase 2A/2B migrations, APIs, tests and Demo Mode remain intact; CI claims are limited to observed GitHub results.

## Reproducible full-stack acceptance implementation

Baseline: `e99df5193dbc6acde9b852004279e91deb31a93f`. This scenario verifies the happy path and version boundaries; it does not close the monitoring-worker or evidence-publisher reliability matrices.

1. Add `backend/scripts/run-phase2c-acceptance.mjs` and a `test:phase2c-acceptance` command. Build the existing backend/contracts, create two fresh isolated databases and local EVM processes, deploy the existing registries, run the scenario once per environment, and clean up resources in `finally`. Use an optional test-only PostgreSQL URL or an ephemeral Docker PostgreSQL container. Retain only explicitly requested safe acceptance artifacts.
2. Add `backend/test/integration/phase2c-acceptance.test.ts`. Use real HTTP authentication, organization authorization, invitation acceptance, wallet-link challenges, bilateral EIP-712 approvals and the existing AgreementRegistry relayer. Confirm the receipt and independently read the registered snapshot.
3. Create an authorized signed-webhook source named as a synthetic acceptance fixture. Advance only the Node test process's Date clock, submit 12 fresh HMAC-authenticated reports over one signed hour (4 healthy, 4 outage, 4 recovery), and keep `PROVIDER_REPORTED` provenance. Assert exact persisted results: coverage 100%, uptime 66.67%, available-latency mean 100 ms, and one `BREACH_CANDIDATE`. Exercise invalid authentication and duplicate delivery without changing guards; retain the existing separate SSRF regressions.
4. Build/export evidence through the API, check deterministic reconstruction and idempotency, publish through the existing EvidenceRegistry worker, and compare every public commitment field through an independent EVM client. Run `npm run verify:evidence -- <file>` against the untouched export and a copied export with one changed observation; require exits 0 and 1 respectively and unchanged original bytes/commitment.
5. Amend the SLA through the API. Verify old sources cannot ingest into the new version, old rows/evidence remain version-bound, and mismatched observation/source versions fail PostgreSQL constraints.
6. Document the exact command, outputs, cleanup and safe diagnostics in `docs/ref/phase2c-acceptance.md`; add the reference to the index and an additive CI step. Run two fresh scenarios and all relevant existing checks, then report actual transaction hashes, verifier results, remaining Gate 3 work and hosted CI status.

Decision: use the signed-webhook boundary rather than an SSRF exception or a fixture-only database seed. A test clock avoids waiting an hour without bypassing webhook freshness checks; it does not measure a real outage. Runtime services, schemas and contracts stay unchanged unless the real scenario exposes a defect. Random database-generated IDs and ingestion timestamps mean roots can differ between fresh runs; deterministic means the same immutable export reconstructs the same root, proofs and digest.

### Remaining Gate 3 reliability tasks

Gate 3A implementation sequence (baseline `63e47a3`): reproduce orphan recovery against isolated PostgreSQL through the public worker poll; add a controlled injectable HTTP-probe boundary; recover expired/missing source leases without inventing measurements; fence all terminal writes with a per-claim token and PostgreSQL time under the source lock; distinguish authorization rejection from transient database failure; test concurrent workers, stale completion/failure, restart, transactional rollback, schedule uniqueness and probe error categories; run Gate 2 and existing regressions; document diagnostics, commit and push only the feature branch, then inspect hosted CI. Preserve the existing schema and no-backfill schedule grid. The strongest alternative is retrying the orphan slot, but a later probe cannot recover its historical measurement; terminal operational failure plus unknown coverage is the chosen policy. Lease renewal is deferred because the bounded probe normally fits the existing 60-second lease; an overrun must lose write authority.

- [x] Exercise monitoring-worker concurrent claims, expired leases, restart recovery, duplicate schedules and collection-failure persistence against PostgreSQL; see [Gate 3A recovery policy and diagnostics](../ref/monitoring-worker-reliability.md).
- [ ] Exercise the evidence-publisher crash/broadcast/RPC/nonce/confirmation/publisher-rotation and commitment-mismatch fault matrix against PostgreSQL and a local EVM.
- [ ] Add dedicated authenticated monitoring/source-management browser flows and a real public-endpoint observation scenario without weakening SSRF restrictions.
- [ ] Map rejected HTTP source validation errors to a suitable client error; current loopback rejection is secure but returns a generic HTTP 500.

## Phase 2C.1 acceptance status

The inherited Phase 2B Playwright failures were traced to an expected duplicate-signature `409` negative path and a signer selector rendered only after wallet ownership verification; a separate pending-agreement signing request was a UI defect and is now suppressed while the agreement awaits counterparty acceptance. The regression tests assert the scoped status/payload and verification prerequisite.

The UI compares evaluations only when agreement version and window boundaries match. It exposes each source's coverage, trust category and health result, plus coverage, uptime and arithmetic-mean latency differences. Low-coverage and unavailable-health comparisons are labeled `INSUFFICIENT_COMPARISON`; differences are review signals and never imply fraud.

Free-text SLA exclusions remain unsupported by the KPI engine. They are not parsed as maintenance windows and cannot alter an anchored agreement's signed meaning.

The controlled local scenario is implemented by `backend/scripts/run-phase2c-acceptance.mjs`; its exact command, expected results, trust limits, artifacts and cleanup are in [the acceptance reference](../ref/phase2c-acceptance.md). Two fresh PostgreSQL/local-EVM runs passed with healthy/outage/recovery reports, persisted KPI/breach/evidence rows, real registry receipts/read-back, standalone verification and tamper rejection. The runtime fix uses `$executeRaw` for advisory locks whose `void` results cannot be deserialized by `$queryRaw`. The inherited hosted browser regressions passed at baseline `e99df51`. Gate 3A adds separate monitoring-worker reliability coverage and retained orphan diagnostics; the evidence-publisher failure/recovery matrix and dedicated authenticated monitoring browser flows remain incomplete. These checks do not establish full Phase 2C or production readiness.

Current repeatable checks are `cd backend && npm ci && npm run lint && npm run build && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:anchor-integration && npm run test:migration-upgrade && npm audit --audit-level=high`, `cd contracts && npm ci && npm run compile && npm test && npm audit --audit-level=high`, and `cd frontend && npm ci && npm run test:api && npm run lint && npx tsc --noEmit && npm run build && npm run test:production-smoke && npm audit --audit-level=high`. The Playwright commands are run by GitHub Actions after it starts isolated PostgreSQL, a local EVM, deploys both registries, and starts the API: `npx playwright test --config=playwright.config.ts --grep "live SLA signing"`, `npx playwright test --config=playwright.config.ts --grep "expired signing authorization"`, and `npx playwright test --config=playwright.config.ts tests/e2e/phase2c.spec.ts` from `frontend/`.
