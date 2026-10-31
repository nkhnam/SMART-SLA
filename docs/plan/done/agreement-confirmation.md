# Gate 4A.1 agreement confirmation

**Goal:** Enforce the approved confirmation policy across worker recovery and read-only API verification, without contract or schema changes.

**Architecture:** One side-effect-free proof evaluator validates the frozen bilateral approval, original signed operation, separately tracked replacement, canonical receipt, inclusive depth and registry record at a pinned head. Only a worker with a live PostgreSQL lease may atomically update the exact agreement version and intent.

**Baseline:** `34122fab919a1243556f041b55a801ef7aa426d1`, `feat/unihack-phase2c-oracle-evidence`.

**Completed:** 2026-10-31 (Asia/Saigon). Implementation `876657012f479d5159d085ca500d7fc8198c92fc` passed [every hosted job](https://github.com/nkhnam/Shadow-Byte/actions/runs/41201478297). N1 is closed; Fuji N2/N3 remain NO-GO. This records the first fully green implementation; final delivery also requires green CI on any subsequent documentation commit.

## Execution

1. Verify branch, clean tree and fetched remote; inspect anchoring, signing, monitoring, consumers and recovery.
2. Add public worker/API regressions; run before runtime edits. Observed RED: 24 failures, 5 passes, zero skips in `node --import tsx --test test/unit/agreement-anchoring.test.ts`. Depth 1/2 incorrectly confirmed, early revert failed, missing/invalid proof verified, API wrote state. Setup completed successfully.
3. Add the shared proof evaluator and route worker/API through it. Preserve `verified` as an on-chain proof verdict; add `durableConfirmed` and proof/depth diagnostics so verification cannot imply a database transition.
4. Fence all worker transitions with agreement/snapshot/intent row locks, database-clock lease validity, recoverable status and version checks; retain original transaction identity. Keep existing pre-broadcast rejection policy.
5. Change R10 to fail-closed reconciliation; add real PostgreSQL/Hardhat N=3, fault/replacement/lease/API tests to the existing CI-covered integration file.
6. Run focused then full prescribed checks; record actual counts, environment failures and exact block evidence. Docker engine is initially unavailable, so hosted PostgreSQL/EVM is the approved fallback.
7. Independently review, fix findings, sync docs/changelog, commit explicit reviewed paths and push only the feature branch. Verify every hosted run at the exact final SHA. No version, release, merge or public-chain transaction.

## Invariant attack paths

| Invariants | Easiest violation / verifier |
| --- | --- |
| I1–I4, I7 | Registry match shortcut, missing/forged receipt, wrong transaction or shallow receipt: worker/API fault matrix. |
| I5–I6 | Early revert or transient RPC treated as absence: pending-depth/retry and sufficiently deep revert tests. |
| I8 | API success or mismatch writes: mutation tripwire and real before/after database equality. |
| I9 | Lease expiry/takeover or amendment during RPC: PostgreSQL barriers and atomic finalization tests. |
| I10–I11 | Waiting worker allocates another nonce or overwrites original with replacement: identity and chain transaction-count assertions. |
| I12–I13 | External matching registration or reverted owned transaction plus another record: reconciliation without broadcast. |
| I14–I15 | Premature monitoring or participant bypass: durable access boundary, signing/role/version regression suites. |

## Scope and trust

Reach: agreement participants and background workers (observed code paths; deployment population unmeasured). Capability: ordinary verification/retry and RPC outages require no exploit. Motive: premature monitoring authorization; blast radius: durable agreement/version integrity. Enforce once at proof and database boundaries. RPC providers remain trusted for truthful canonical chain data; deep reorg after durable confirmation and automatic external-transaction discovery remain outside this gate. Fuji N2/N3 remain blocked.

## Local verification and review

- Backend: initially 79/79, then 85/85 unit tests after the hosted-failure/review corrections, zero skips/cancellations; lint, production typecheck/build and anchor integration typecheck passed. Production dependency audit reports zero vulnerabilities. Node 26 emits existing loader deprecation warnings; CI uses Node 24.
- Contracts: compile/typecheck and 17/17 tests passed on isolated EVMs; no contract changes.
- Frontend: lint/TypeScript and 7/7 API tests passed; production build and 12 route smoke checks passed after a generated-directory sandbox `EPERM` required an unsandboxed retry. No frontend source changes.
- Local integration and migration-upgrade cannot connect to PostgreSQL. Gate 2/3A/3B/3C each failed during Docker PostgreSQL setup before tests; no passing database/EVM claim is made from these runs. Use the existing hosted PostgreSQL/Hardhat workflow for current evidence. Gate 3D remains opt-in and was not run because its PostgreSQL prerequisite is unavailable.
- Independent read-only review found and closed a final-head RPC promise rejection escaping the typed evaluator, a reverted-send fixture assumption and missing API/worker interleaving. A worker regression checks final-head RPC rejection remains recoverable. No further runtime blocker was found in the rereview; hosted integration execution remains the deciding evidence.
- The initial 24 RED failures preceded runtime edits. Replacement, database fencing and integration scenarios were expanded during implementation/review; they are not represented as baseline RED observations. Old unit mocks were updated to supply the real frozen snapshot and live-lease query contract; setup mismatches were not counted as production defects.
- First hosted delivery `35509c7` failed Gate 2 at `ANCHOR_PENDING` after backend/frontend/contracts validation passed. A real local Hardhat probe reproduced the implementation defect: legacy RPC transactions omit `chainId`, although signed EIP-155 `v` identifies the chain. A new four-case RED run had one expected failure (valid EIP-155) and three fail-closed passes. Deriving only from signed `v`, using viem's existing parser rule, fixes this without a configured-chain fallback. Closing review also added stable-head checks before code/domain reconciliation; reorg uncertainty remains recoverable.
- R01/R09 originally simulated retry by changing only the intent from FAILED to SUBMISSION_UNCERTAIN while leaving its agreement ANCHOR_FAILED. That fixture violates the approved atomic two-row state invariant; the live-lease fence correctly rejects it. The scenarios now call the existing authorized `retry()` entry point, assert the agreement returns to ANCHOR_PENDING and retain every transaction/hash/nonce/duplicate assertion. Cleanup removes only audit events belonging to those owned fixture agreements. This is a fixture correction, not a reproduced production defect.

## Hosted verification

| Check at 8766570 | Observed result |
| --- | --- |
| Backend lint, build, production and anchor-integration typechecks | Pass |
| Backend unit / API integration / migration upgrade | 85/85, 5/5, upgrade/constraints/rollback pass |
| Agreement PostgreSQL/Hardhat fault matrix | 26/26, including R10, N=3, replacements, conflicting registration, leases, version fencing, API concurrency and atomic rollback |
| Gate 2 | 7/7 in each of two fresh PostgreSQL/EVM runs |
| Gate 3A | 24/24 in each of two fresh PostgreSQL runs |
| Gate 3B | 49/49 in each of two fresh PostgreSQL/EVM runs |
| Gate 3C / inherited live signing / expired authorization | 4/4, 1/1, 1/1 browser tests |
| Responsive monitoring browser cases | 3/3 at the existing viewport scenarios |
| Frontend lint, TypeScript, build, API and production smoke | Pass; 7/7 API tests and 12 route checks |
| Contracts compile, typecheck, tests and audit | Pass; 17/17 tests, no contract change |
| Skips, cancellations and retries | Zero skipped/cancelled test cases; no retry/flaky result observed. Only the two failure-only diagnostic/upload steps were conditionally skipped. |
| Dependency limits | High-severity thresholds pass. Full backend/frontend audits retain 11/16 moderate advisories; backend production-only audit reports zero vulnerabilities. No lockfile change. |

Actual N=3 evidence from that hosted local EVM: receipt block **15**, nonce **14**, transaction `0x8b7960a6158929fef851519e8519a4b180a0fd161f5b4ae163804cdfd35168e8`. At heads **15/16/17**, depths **1/2/3** produced **SUBMITTED/SUBMITTED/CONFIRMED**. The test asserted identical original hash/bytes/nonce throughout, exactly one registration event and one relayer nonce consumed, API nonmutation and blocked monitoring before the worker commit. Fresh reruns generate different agreement IDs/transaction hashes; this hash belongs specifically to the linked run.

Delivery history: `35509c7` implemented the gate; its first CI failed on the real legacy-RPC chain-field omission. `a87d592` fixed that omission and head rechecks; Gate 2/3A/3B passed, with 23/25 agreement cases passing and only the inconsistent R01/R09 fixtures failing. `8766570` corrected those fixtures, added the conflicting-registration scenario and passed the full workflow. No failure is represented as a green run, no assertion or timeout was weakened, and no public-chain transaction, funding, deployment, merge, release, tag, schema or Solidity change occurred.

A final API response regression found that a signing-context RPC outage returned `durableConfirmed: false` despite already-confirmed database rows. The one-case RED run failed exactly that assertion. Verification now retains its read-only database observation in the RPC-error response while `verified: false` reports unavailable current chain proof. This changes no durable state or monitoring authorization.

A separate public-worker RED case reproduced a nonce-read RPC error containing rejection wording being misclassified as a terminal broadcast rejection (`FAILED` instead of `SUBMITTED`). Only the actual send boundary now identifies a definitive RPC rejection; the original allowlisted error telemetry is preserved. Other RPC rejection wording remains retryable, with unchanged identity and no broadcast. Existing deterministic unprepared contract-revert handling and actual rejected-send retry policy remain intact. Preparation/recovery unit cases and a real PostgreSQL/EVM recovery fault raise the final suites to 88 unit cases and 27 agreement integration cases. Final delivery requires exact-commit hosted CI after these corrections.
