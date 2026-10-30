# Changelog

## [Unreleased]

### Added
- Add opt-in Gate 3D real public HTTPS acceptance through the default HTTP_PROBE worker, isolated PostgreSQL, sparse KPI evaluation, existing evidence export/local-EVM publishing, standalone tamper rejection, version isolation and explicit network-failure diagnostics; keep external-network checks outside deterministic CI.
- Add deterministic HTTP-probe regressions for both pinned DNS callback modes, redirect DNS revalidation, HTTPS hostname preservation, HTTP/TLS/DNS errors, timeout and response-size limits.
- Add authenticated monitoring Playwright flows against isolated PostgreSQL/local EVMs for source lifecycle, secret rotation, role/organization/version boundaries, sparse KPI evaluation, evidence download, logout and responsive layouts.
- Add the Gate 3B two-run isolated PostgreSQL/local-EVM publisher fault matrix, including process loss, RPC uncertainty, nonce contention/replacement, persisted-byte integrity, publisher rotation, receipt finality and PostgreSQL rollback; run it with Gate 2/3A in CI.
- Add a two-run isolated PostgreSQL monitoring-worker reliability command and CI step covering concurrent claims, process termination, expired/missing leases, stale writers, schedule idempotency and PostgreSQL transaction failures through controlled probe-boundary fixtures.
- Add a two-run full-stack Phase 2C acceptance command using isolated PostgreSQL and local EVMs, real bilateral signing and evidence relaying, labeled synthetic webhook reports, deterministic KPI/evidence checks, standalone tamper rejection and agreement-version isolation; retain safe artifacts in CI.
- Add version-bound monitoring sources and observations, safe HTTP probes, authenticated provider webhooks, deterministic KPI evaluations, breach candidates, canonical evidence exports, and a separately authorized EvidenceRegistry with a durable publisher worker.
- Add Live Workspace monitoring and source management with source trust labels, cross-source KPI comparison, observation history, evidence export, and verification status.
- Document Phase 2C collection policy, KPI rules, evidence verification, threat boundaries, retention, and local EvidenceRegistry deployment.
- Add a frontend-only SLA-DEX workspace with agreement, monitoring, dispute, verification, and settings previews backed by deterministic demo data.
- Add an authenticated NestJS API, PostgreSQL persistence, immutable draft agreement versions, and a separate live workspace for agreement editing.
- Add an isolated PostgreSQL integration test setup and a CI workflow for backend and frontend validation.
- Add organization invitations, bilateral EIP-712 signatures, an immutable agreement snapshot, and a permissionless Avalanche agreement registry with a durable relayer intent.
- Add an isolated Solidity workspace with local-EVM signing tests and a manual Fuji deployment guide.

### Changed
- Replace stale README acceptance/browser-coverage statements with implemented gate references, trust limits, reproduction commands and remaining Fuji prerequisites.
- Document monitoring-worker and evidence-publisher recovery states, authenticated monitoring browser diagnostics and separate opt-in real HTTPS acceptance; the current checks do not establish full Phase 2C or production readiness.
- Persist signed relayer transactions before broadcast, reconcile uncertain submissions without allocating a new nonce, and add recovery, migration-upgrade and contract authorization-boundary coverage; the database-backed upgrade check and hosted CI run remain unverified in this environment.
- Discover mined same-nonce replacements within a bounded 128-block scan, preserve uncertainty for unidentified pending replacements, and route consumed nonces without a match to manual reconciliation.
- Add the PostgreSQL/local-EVM relayer fault matrix and Playwright wallet-flow suite to the existing hosted workflow; the new integration and browser suites still require a hosted run for verification.
- Use the supported Webpack builder for production builds and add a production HTTP smoke check; document the unresolved Turbopack worker failure and browser-test limitation.
- Generate Prisma Client before CI typechecks and exercise CSRF rejection, database constraints, agreement pagination, and date filters in integration coverage.
- Preserve all Phase 1 demo routes and fixture behavior while linking them to the opt-in live workspace.
- Extend CI to validate the Phase 2B branch and compile/test contracts on a local EVM without Fuji credentials.
- Document Phase 2B signing security, snapshot hashing, lifecycle, relayer recovery, and Fuji deployment boundaries.

### Removed
- Remove the legacy NestJS/PostgreSQL backend, Polygon contracts, backend-connected frontend flows, and AISC demo assets from the Phase 1 branch.

### Fixed
- Return a one-element validated address list when Node requests `all: true` from the pinned DNS callback, fixing real HTTPS probes that previously failed with `ERR_INVALID_IP_ADDRESS` while preserving public-IP checks and TLS hostname validation.
- Convert monitoring observation pagination query strings before validation, persist source pause/resume while preserving the concurrent active-source quota, align management controls with source ownership, return HTTP 400 for rejected endpoints, and contain agreement selectors and one-time secret notices on narrow screens.
- Fence evidence transaction preparation, broadcast admission and state writes with per-claim leases; preserve and validate signed bytes across uncertain sends, wait for known pending transactions and reconcile consumed unknown nonces without creating replacement operations.
- Bind evidence commitment/confirmed-nonce decisions to one canonical block snapshot and require confirmation depth for both successful and reverted receipts; compare all commitment fields and separate historical reporter identity from current publisher configuration.
- Stop owned crash-fixture child processes when their test is cancelled, including the inherited Gate 3A probe fixture, without increasing its timeout.
- Fence monitoring completion/failure writes with per-claim ownership, PostgreSQL lease time and the source lock; retain orphan runs as explicit failed collection attempts without inventing downtime or replaying historical slots.
- Keep monitoring sources enabled after transient database errors during agreement validation; only explicit agreement authorization rejection disables a source.
- Execute monitoring source/evidence advisory locks without deserializing PostgreSQL `void` results, fixing source and evidence creation failures on real PostgreSQL.
- Reload the Customer agreement after Provider invitation acceptance and assert the signing-ready state before wallet verification in the expired-authorization browser regression.
- Treat contract reverts before transaction preparation as failed anchors rather than retryable RPC outages, and refresh the Customer view after the final Provider signature before checking expired-approval rejection.
- Scope monitoring loading state to the selected organization and agreement, remove synchronous effect updates, and ignore cancelled requests so late responses cannot replace current data or errors.
- Stop requesting agreement signing data while an invitation is still awaiting counterparty acceptance; assert the duplicate-signature `409` response by request and verify signer selection only after wallet ownership verification.
- Add deterministic matching-window source comparison with coverage, health-result, uptime and latency differences; low-coverage comparisons remain explicitly insufficient and are not interpreted as fraud.
- Pin Playwright and viem as frontend development dependencies, remove CI's temporary installation step, and add separate inherited browser regression steps plus a responsive Phase 2C empty-state case.
- Record that free-text exclusions are unsupported calculation inputs and distinguish measurement truth, source provenance, evidence integrity, chain commitment and agreement signing.
- Register the static invitation inbox route before the agreement UUID route so `/agreements/invitations` reaches the authenticated invitation handler.

### Security
- Upgrade Next.js and its matching ESLint config to 16.4.3 and refresh the lockfile to clear reported dependency vulnerabilities.
- Enforce server-checked membership scope, opaque HttpOnly sessions, CSRF origin checks, role-gated writes, and production HTTPS CORS origins.
- Pin patched `solc`, `tmp` and Zod versions after dependency auditing found high-severity advisories in the initial contract toolchain.
