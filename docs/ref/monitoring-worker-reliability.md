# Monitoring worker reliability — Gate 3A

Baseline: `63e47a3` on `feat/unihack-phase2c-oracle-evidence`. This gate covers the PostgreSQL monitoring collector, not production readiness or the evidence publisher's Gate 3B fault matrix.

## UNDERSTAND — baseline state machine

An enabled HTTP source becomes due at `nextRunAt`. One transaction locks the source with `FOR UPDATE SKIP LOCKED`, creates a `RUNNING` run for that timestamp, sets a 60-second source lease, and advances `nextRunAt` to the first future point on the existing interval grid. The worker validates the exact signed agreement version and probes outside the transaction. A second transaction inserts the observation, marks the run `COMPLETED`, records `lastRunAt`, and releases the source lease. An internal collection/persistence exception attempts to mark the run `FAILED` without an observation. HTTP network failures returned by the probe are actual categorized measurements, distinct from internal collection failures.

| Risk/window | Baseline finding | Recovery after this change |
| --- | --- | --- |
| Two workers claim the same due slot | No reproduced defect: source row locking and the unique `(sourceId, scheduledFor)` run key already serialize claims. | Retain both safeguards; test simultaneous transactions and a second poll while the first probe is held. |
| Claim transaction fails after run creation | Atomic rollback already protects the run and schedule. | PostgreSQL trigger fault proves no run or schedule advancement survives; a later poll can claim normally. |
| Process dies after claim commit, before observation | Confirmed defect: the advanced schedule leaves an orphan `RUNNING` indefinitely, including when the next schedule is still in the future. | After lease expiry, retain and close the orphan as `FAILED/lease_expired`, clear its lease, and leave the missed measurement unknown. |
| Missing lease or disabled orphan source | Confirmed recovery gap: the due/enabled filter excludes recovery work. | Recover `RUNNING` rows on HTTP sources independently of enabled/due state; use `lease_missing` for a missing expiry. |
| Old worker returns after expiry/ownership change | Confirmed defect: observation and terminal-run writes were not fenced, and stale failure handling could overwrite diagnostics. | Require the current per-claim token, an unexpired lease, and a matching `RUNNING` run under the source lock for every terminal write. |
| PostgreSQL failure during active-version validation | Confirmed defect: a broad catch disabled the source as though agreement authorization had failed. | Only explicit not-found/conflict authorization rejections disable it; database errors leave it enabled and create no observation. |
| Persistence or failure-persistence fails | A successful observation/run/lease transaction is already atomic; a failed fallback can leave an orphan. | Prove rollback with PostgreSQL `40001` faults; if failure recording also fails, preserve `RUNNING` for subsequent lease recovery. |
| Restart after successful commit / duplicate delivery | No reproduced duplicate defect: run-slot, observation-run and source-idempotency unique keys already exist. | Retain constraints and assert they reject duplicate writes; a recreated worker does not replay a completed slot. |

The baseline fault matrix observed seven failing cases and eleven passing characterization cases. The failing cases covered future-schedule orphan recovery, late success/failure/inactive-version completion, expiry without takeover, disabled/missing-lease recovery, and database errors misclassified as inactive agreements. These are reproducible defects, not claims of incidents in a deployed system.

## REASON and DECIDE — recovery policy

Goal chain: durable scheduled collection → trustworthy coverage and diagnostics → evidence that does not invent service behavior. Facts: a probe is a present-time measurement, claim already advances the schedule, and observations are immutable/version-bound. Constraints: preserve the current interval grid, authorization, SSRF protections and absence-as-unknown policy. The normal probe is expected to fit the existing lease; it is not assumed that processes always finish within it.

Choose terminal operational failure for a lost slot, not a new probe labeled with its historical schedule. Retrying the old run could improve apparent coverage and reduce lost samples after short failures, but cannot reconstruct historical service health. Holding a database transaction across HTTP I/O would simplify ownership, but consumes a connection and lock across network stalls and still cannot recreate a lost measurement. Lease renewal adds another failure protocol; it is unnecessary for this bounded collector and is deferred. Reopen that choice if measured normal collection frequently exceeds the existing lease.

The main cost of the chosen policy is lower coverage after process or database failures. A six-month failure scenario would be operational stalls repeatedly losing measurements while alerts are ignored; monitor orphan/error diagnostics and coverage rather than interpreting the absence of breach candidates as health. Another trade-off is recovery throughput: it shares the existing ten-item poll budget. Database unavailability or backlog can delay recovery; there is no fixed wall-clock recovery guarantee. This gate adds no heartbeat, retry loop, lease-duration increase, probe-timeout increase, historical backfill, schema migration, or public API.

Reach is every enabled HTTP source (code fact); capability is an ordinary process crash, database error or overlapping worker poll (reproduced); adversarial motive is unnecessary; blast radius is source coverage/evidence integrity. The sufficient boundary is the existing PostgreSQL source lock plus database uniqueness, with explicit retained failure records.

## IMPLEMENT — resulting state machine and invariants

| State/transition | Persisted outcome |
| --- | --- |
| Due → claimed | Atomically `RUNNING`, a fresh per-claim token, 60-second lease, and first-future-grid `nextRunAt`. |
| Owned valid result → completed | Atomically one observation, `COMPLETED`, `completedAt`, `lastRunAt`, and a cleared lease. |
| Owned internal failure → failed | `FAILED` plus a safe `errorCode`, `completedAt`, cleared lease, no observation; source stays enabled. |
| Owned inactive agreement → failed/disabled | `FAILED/agreement_version_inactive`, disabled source, null schedule and cleared lease; no observation. |
| Lease expires or disappears with `RUNNING` rows | Next eligible recovery poll closes all such source runs with `lease_expired` or `lease_missing`, preserves IDs/schedules, clears the lease, and can claim a genuinely due later slot. Disabled sources stay disabled. |
| Stale completion/failure → rejected | No observation, terminal-state overwrite, lease clearing, or source disablement by the stale owner. The authoritative owner/recovery poll handles the run. |
| Terminal write cannot reach PostgreSQL | No invented outcome. Atomic rollback leaves the previous state; if failure recording cannot commit, lease recovery handles the retained `RUNNING` row once PostgreSQL returns. |

Claim and finalization use PostgreSQL `clock_timestamp()`, not the worker's wall clock. Finalization locks the source first, then checks time, token and run status. Its authority check is the linearization point: once admitted with a live lease, the short database transaction holds that lock through commit, even if wall-clock expiry passes during the transaction. A waiting claimant cannot take ownership during those writes. An already-expired lease at this check is rejected even when nobody has reclaimed it. No network I/O occurs while this finalization lock is held.

At most one run exists per source/scheduled timestamp and at most one observation per run; the existing database constraints enforce both. Completion, observation insertion and lease release commit together. Terminal run diagnostics are never overwritten by another lease owner. Recovery never deletes or silently replaces a run and never synthesizes an observation. Missing and invalid samples remain unknown in KPI coverage. `TIMEOUT`, `DNS`, `CONNECTION`, `TLS` and `HTTP` probe results retain the existing valid failed-measurement semantics; `INVALID_RESPONSE` and `RESPONSE_TOO_LARGE` remain invalid observations with null reachability.

Authorization and signed-version checks remain at the existing collection boundary; agreement mutations during an in-flight probe are not newly serialized by this gate. Observations still bind to the claimed source's exact immutable version through existing foreign keys. The real agreement/API isolation regressions and Gate 2 acceptance remain required. SSRF validation, public DNS pinning, redirect revalidation, response-size limits and fixed probe request behavior are unchanged.

## VERIFY — reproducible checks

From `backend/`, with an absolute artifact directory:

````powershell
npm run test:monitoring-reliability -- --output "C:\absolute\artifacts"
npm run test:phase2c-acceptance -- --output "C:\absolute\artifacts"
````

The reliability command reuses the acceptance runner's PostgreSQL lifecycle with `--worker-reliability`, skips EVM deployment, builds the backend, migrates two newly created `phase2c_<random>_test` databases, and runs `monitoring-worker.integration.test.ts` in each. It uses Docker PostgreSQL 17 by default, or the same guarded local `TEST_DATABASE_URL`/CREATEDB option as [Gate 2 acceptance](phase2c-acceptance.md). The supplied database is not reset. Each owned database/container and isolated child home is removed in `finally`; requested safe logs remain in the printed artifact directory. CI runs both commands and uploads both sets of logs.

The suite exercises simultaneous claims, held-probe contention, expiry before takeover, expiry while finalization actually waits for a PostgreSQL source lock, stale success/throw/authorization failure during takeover, restart with active/expired/missing leases, disabled orphans, real process termination after claim commit, grid-preserving skipped intervals, duplicate-key rejection, all probe error categories, internal collector errors, explicit authorization rejection, and PostgreSQL `40001` failures during claim, validation, observation insertion and failure recording. Promise barriers, `pg_blocking_pids` and explicit database timestamps drive transitions; no race is hidden by sleeping or increasing timeouts. The test timeout is only a deadlock deadline. A controlled mutation replacing finalization's current-time comparison with transaction-start `NOW()` made the lock-wait case fail with one prohibited observation; the other 23 cases passed. The correct comparison was restored before final verification.

Successful worker cases seed minimal version-bound relational fixtures and substitute the active-agreement dependency; this isolates lease behavior rather than fabricating signatures. The inactive-agreement case uses the real access service. Only the injected HTTP-probe function supplies measurements: no loopback/public endpoint is contacted and no SSRF rule is bypassed. Gate 2 separately exercises the real authenticated agreement/signature/network checks through Nest and the API. Categorized probe fixtures verify persistence semantics, not actual public-network reliability.

Local verification on 2026-10-30: the reliability matrix passed 24/24 cases in each of two fresh databases, with zero skips, including simultaneous claims, preserved schedule grid, post-lock lease time and orphan-as-unknown KPI behavior. Gate 2 passed two fresh PostgreSQL/EVM scenarios (one parent plus six stages each), original/tampered verifier exits 0/1, 12 observations per scenario, 100% coverage, 66.67% uptime and unchanged version-one evidence. Backend unit tests passed 42/42; existing API integration passed 5/5; migration-upgrade checks passed; contracts passed 11/11; frontend API/comparison/wallet tests passed 7/7. Backend lint, typecheck and anchor-integration typecheck passed. Frontend lint could not run locally because its existing dependencies lacked the `eslint` executable; hosted CI installs the complete dependency set and remains the authority for the browser and relayer regression run.

Changed files: `backend/src/monitoring/monitoring-worker.service.ts` owns recovery/fencing/diagnostics; `http-probe.ts` exports the probe injection token; `monitoring.module.ts` binds its unchanged production implementation. `backend/test/integration/monitoring-worker.integration.test.ts` owns the PostgreSQL fault matrix; `backend/scripts/run-phase2c-acceptance.mjs` reuses isolation/cleanup for the new mode; `backend/package.json` exposes the command; `.github/workflows/phase2a.yml` runs it. `docs/arch/phase2c-monitoring.md`, `docs/ref/phase2c-acceptance.md`, `docs/plan/phase2c-oracle-evidence.md`, this reference and `docs/index.md` synchronize recovery policy and remaining gates. `CHANGELOG.md` records the changes under Unreleased and consolidates its existing duplicate/nonstandard headings without minting a version.

## TEACH BACK — diagnostics and remaining gate

Expected diagnostics are `Recovering ... orphaned monitoring run(s)` with source ID and `lease_expired`/`lease_missing`, `write rejected (lease_lost_or_run_terminal)` with run/source IDs, and run/poll failures with a safe category such as `database_P2034`. Recovery logs describe an attempted transaction; PostgreSQL state is authoritative if that transaction subsequently rolls back. No endpoint, webhook secret, provider body or database URL is included in worker diagnostics.

Use this read-only query to distinguish expected active work from overdue recovery; it retains the run identity and never changes a lease:

````sql
SELECT run."id", run."sourceId", run."scheduledFor", run."status", run."errorCode",
       run."completedAt", source."enabled", source."nextRunAt", source."leaseUntil",
       observation."id" AS "observationId",
       (source."leaseUntil" IS NULL OR source."leaseUntil" <= clock_timestamp()) AS "leaseExpiredOrMissing"
FROM "MonitoringRun" run
JOIN "MonitoringSource" source ON source."id" = run."sourceId"
LEFT JOIN "MonitoringObservation" observation ON observation."runId" = run."id"
WHERE run."status" = 'RUNNING' OR run."errorCode" IN ('lease_expired', 'lease_missing')
ORDER BY run."scheduledFor", run."id";
````

An unexpired `RUNNING` row is expected after a crash until its lease expires. An expired `RUNNING` row after successful recovery polls needs investigation: inspect database errors, backlog, and transaction failures. `FAILED/lease_expired` with no observation is an explicit lost measurement, not downtime. Do not delete these rows or set observations healthy to silence diagnostics.

The separate [Gate 3B reliability command](evidence-publisher-reliability.md) covers evidence-publisher crash/broadcast, uncertain RPC submission, identical-byte rebroadcast, nonce contention, confirmation depth, publisher rotation, mismatching commitments and durable lease recovery against PostgreSQL/local EVM. Its test cancellation cleanup also stops and awaits the inherited Gate 3A crash fixture's child without extending the 15-second deadline. Dedicated authenticated monitoring-management browser flows and a real public-endpoint observation scenario remain separate acceptance work. No main merge, Fuji deployment or production-readiness claim belongs to these gates.
