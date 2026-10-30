# Changelog

## [Unreleased]

### Fixed
- Scope monitoring loading state to the selected organization and agreement, remove synchronous effect updates, and ignore cancelled requests so late responses cannot replace current data or errors.
- Stop requesting agreement signing data while an invitation is still awaiting counterparty acceptance; assert the duplicate-signature `409` response by request and verify signer selection only after wallet ownership verification.
- Add deterministic matching-window source comparison with coverage, health-result, uptime and latency differences; low-coverage comparisons remain explicitly insufficient and are not interpreted as fraud.
- Pin Playwright and viem as frontend development dependencies, remove CI's temporary installation step, and add separate inherited browser regression steps plus a responsive Phase 2C empty-state case.
- Record that free-text exclusions are unsupported calculation inputs and distinguish measurement truth, source provenance, evidence integrity, chain commitment and agreement signing.

### Known incomplete acceptance
- The controlled PostgreSQL/local-EVM monitoring outage demo, worker concurrency/restart integration tests, evidence publisher fault matrix, and hosted Phase 2C browser result remain incomplete; Phase 2C acceptance is therefore pending.

### Added
- Add version-bound monitoring sources and observations, safe HTTP probes, authenticated provider webhooks, deterministic KPI evaluations, breach candidates, canonical evidence exports, and a separately authorized EvidenceRegistry with a durable publisher worker.
- Add Live Workspace monitoring and source management with source trust labels, cross-source KPI comparison, observation history, evidence export, and verification status.
- Document Phase 2C collection policy, KPI rules, evidence verification, threat boundaries, retention, and local EvidenceRegistry deployment.
- Add a frontend-only SLA-DEX workspace with agreement, monitoring, dispute, verification, and settings previews backed by deterministic demo data.
- Add an authenticated NestJS API, PostgreSQL persistence, immutable draft agreement versions, and a separate live workspace for agreement editing.
- Add an isolated PostgreSQL integration test setup and a CI workflow for backend and frontend validation.
- Add organization invitations, bilateral EIP-712 signatures, an immutable agreement snapshot, and a permissionless Avalanche agreement registry with a durable relayer intent.
- Add an isolated Solidity workspace with local-EVM signing tests and a manual Fuji deployment guide.

### Changed
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
- Register the static invitation inbox route before the agreement UUID route so `/agreements/invitations` reaches the authenticated invitation handler.

### Security
- Upgrade Next.js and its matching ESLint config to 16.4.3 and refresh the lockfile to clear reported dependency vulnerabilities.
- Enforce server-checked membership scope, opaque HttpOnly sessions, CSRF origin checks, role-gated writes, and production HTTPS CORS origins.
- Pin patched `solc`, `tmp` and Zod versions after dependency auditing found high-severity advisories in the initial contract toolchain.
