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
