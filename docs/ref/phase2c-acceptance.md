# Phase 2C full-stack acceptance

This synthetic scenario exercises real PostgreSQL, the authenticated Nest API, bilateral signatures, both local EVM registries, KPI/evidence persistence, the evidence publisher and the existing standalone verifier. It is an integration acceptance check, not a real service-outage measurement or a production-readiness claim.

## Run

Requirements: Node matching the backend manifest and Docker with a Linux engine. In PowerShell, run this exact sequence from the repository root:

````powershell
npm ci --prefix backend
npm ci --prefix contracts
cd backend
npm run test:phase2c-acceptance -- --output "$env:TEMP\sladex-acceptance"
````

On a POSIX shell, the command from `backend/` is `npm run test:phase2c-acceptance -- --output "${TMPDIR:-/tmp}/sladex-acceptance"`. An explicit absolute output directory can replace either example. CI uses `$RUNNER_TEMP/phase2c-acceptance` and uploads the safe artifacts on success or failure.

The runner builds the backend and contracts, starts a disposable PostgreSQL 17 container on an OS-assigned loopback port, and performs two fresh runs. Each run creates a uniquely named `_test` database, starts a separate Hardhat chain on an available loopback port, deploys both existing registries, and starts the real API on an OS-assigned port. Registry deployment and publishing use separate local development accounts; there is no Fuji RPC or deployment path in this runner.

To use an existing local test PostgreSQL server, set `TEST_DATABASE_URL` before running the same command. The URL must use `postgresql://`, a loopback hostname and a database name ending in `_test`; its user needs permission to create/drop sibling databases. The named database is not reset, migrated or populated by this harness. Each scenario owns a new `phase2c_<random-id>_test` sibling. The local EVM remains fresh for each run.

## Expected results

The command exits zero and prints two JSON summaries followed by `Phase 2C acceptance: 2 fresh runs passed`. Each run has one parent acceptance test and six named stages:

1. Register two real authenticated organizations, accept an invitation, verify wallet ownership, select signers, submit valid bilateral signatures, and confirm the AgreementRegistry anchor through the actual relayer. Independently read its receipt, snapshot hash and version from the EVM.
2. Configure a `SIGNED_WEBHOOK` source named `SYNTHETIC acceptance fixture: healthy -> outage -> recovery`. Submit 12 HMAC-authenticated observations: four healthy, four unreachable, four recovered, at five-minute intervals. Bad HMAC is rejected and duplicate webhook delivery does not append another observation. Existing SSRF regression tests remain separate; this scenario does not probe an HTTP endpoint.
3. Evaluate the exact signed one-hour window. PostgreSQL must contain 12 expected samples, 8 healthy, 4 failed, 0 unknown, 100% coverage, 66.67% uptime, 100 ms arithmetic-mean available latency, and exactly one `BREACH_CANDIDATE`. Repeating evaluation returns the same persisted evaluation.
4. Build/export evidence, reconstruct the same root/proofs from its immutable records, and check repeated build idempotency. Run the real evidence publisher and compare all public commitment fields, publisher, receipt and chain timestamp using an independent local EVM client.
5. Invoke `npm run verify:evidence -- <file>` as a separate process on the original export (exit 0, `valid: true`) and a copied export with one observation's reachability flipped (exit 1, `valid: false`). Original bytes and on-chain commitment must remain unchanged.
6. Amend the agreement to version 2 through the API. Old-source ingestion and source configuration on unsigned version 2 must fail. PostgreSQL must reject an observation with mismatched source/version foreign keys; all 12 version-1 observations and their evidence remain unchanged and exportable by the owner.

Node's test clock advances only `Date` in the acceptance process. Each synthetic report is ingested at its simulated observation time, so the production five-minute freshness checks run normally. No freshness, SSRF, CSRF, role, signature or registry check is disabled. Worker timers are stopped through their existing lifecycle methods and their public processing methods are called explicitly; chain receipts and database states are asserted after processing. PostgreSQL/EVM startup waits poll real readiness conditions with deadlines rather than assuming a delay is sufficient.

## Trust and determinism

The source and exported records retain `PROVIDER_REPORTED`, a synthetic fixture source name and `synthetic-acceptance-fixture` agent identity. Stored raw provider metadata additionally marks `synthetic: true`, the phase, and `independentMeasurement: false`. An authenticated provider report proves possession of the source secret; it does not prove service health. The supplied outage and recovery values are controlled test inputs.

The same immutable export must reconstruct the same leaf digests, Merkle proofs, root and manifest digest. Fresh runs can have different roots because real PostgreSQL generates new IDs and ingestion timestamps. Repeatability means the same asserted behavior and KPI values across isolated runs, not identical random identities or transaction hashes.

The standalone verifier checks internal cryptographic integrity without the API. Its result is bound to the real commitment only after the separate registry read-back comparison. Someone who changes records and recomputes every hash could make a new self-consistent file; it would still disagree with the original chain commitment. Neither cryptographic integrity, an authorized publisher, nor bilateral SLA signing establishes objective measurement truth.

## Evidence, cleanup and diagnostics

Each invocation creates a new `phase2c-*` artifact directory, so rerunning cannot overwrite an earlier export. Each `run-1/` and `run-2/` contains `evidence.json`, `evidence-tampered.json`, both verifier verdicts, `summary.json`, migration/test logs and a sanitized EVM log. Summaries include both transaction hashes, registry addresses, batch key, root, digest, KPI results and version-isolation/verification verdicts. Private keys, session cookies and webhook secrets are not artifact fields. Raw EVM key/hash strings and database URLs are redacted from diagnostic logs.

On failure, the command exits nonzero, names the artifact directory and failing command log, and writes `failure.json` with the acceptance stage and error type if the API scenario started. Check `test.log`, `migrations.log`, `evm.log`, `postgres-start.log`, `postgres.log`, and the build logs. The intentionally tampered verifier exit 1 and the tested PostgreSQL foreign-key rejection are expected negative results, not harness failures.

The runner stops its API/EVM processes, drops only its uniquely created databases and removes only its owned Docker container in cleanup. Node child processes use an isolated home/cache/temp directory, removed after the run. It never stops an existing PostgreSQL server. Artifacts are deliberately retained; delete the printed invocation directory when no longer needed. If the runner is forcibly terminated before cleanup, use the generated `sladex-phase2c-*` container name and `phase2c_<id>_test` database name from that invocation's diagnostics to remove only those resources.

## Remaining Gate 3 work

- Monitoring-worker claim contention, lease expiry, duplicate scheduling, process restart and collection-failure persistence now have the separate [Gate 3A PostgreSQL reliability command](monitoring-worker-reliability.md); run it alongside this Gate 2 scenario.
- Evidence-publisher crash/broadcast, RPC, nonce, confirmation, publisher-rotation and durable lease recovery now have the separate [Gate 3B PostgreSQL/local-EVM reliability command](evidence-publisher-reliability.md); run it alongside Gate 2/3A.
- Authenticated browser monitoring/source management beyond the current browser cases, and a real public-endpoint observation scenario that preserves all SSRF controls.
- HTTP source validation currently blocks loopback URLs but maps the thrown validation error to a generic HTTP 500; improving that response is outside this signed-webhook acceptance scenario.
- Fuji deployment, funded transactions, operational configuration and production readiness remain separate gates; this scenario performs none of them.
