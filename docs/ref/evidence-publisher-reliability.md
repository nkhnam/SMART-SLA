# Evidence publisher reliability — Gate 3B

Baseline: `79aa99f` on `feat/unihack-phase2c-oracle-evidence`. This gate tests durable publication to the local EvidenceRegistry; it does not establish measurement truth, complete Phase 2C acceptance or production readiness.

## UNDERSTAND — baseline state machine and failure windows

The publisher claims one `PENDING` or `SUBMITTED` intent with a 60-second PostgreSQL lease. It checks the configured chain/registry/publisher, reads an existing commitment, and either confirms/reconciles it or prepares a transaction. Preparation serializes the dedicated evidence wallet's nonce allocation with advisory lock `8273642`, persists signed bytes/hash/domain/sender/nonce, then broadcasts outside the transaction. Successful broadcast records `SUBMITTED`; a later poll checks receipt/read-back and records `CONFIRMED`. `FAILED` and `RECONCILIATION_REQUIRED` are terminal to automatic polling.

Persist-before-send and the unique batch key already make crash recovery possible. A process crash can leave either unsigned work or signed work whose submission is unknown. There is no safe inference from an RPC timeout to “not broadcast.” A receipt-not-found response is different from a transport failure. A matching commitment does not prove that the configured confirmation depth has elapsed. The current publisher identity can also change after a historical transaction was validly included.

| Window | Baseline finding | Required outcome |
| --- | --- | --- |
| Crash after preparation/before send, or after inclusion/before PostgreSQL update | Durable bytes/nonce/hash already exist; top-level exceptions left the lease until expiry and no persisted diagnostic. | Reclaim after expiry, reconcile receipt/read-back, reuse the same operation; retain diagnostics when recording is possible. |
| Receipt RPC fails | Broad catches treated RPC errors like missing receipts and could rebroadcast or defer silently. | Keep the operation uncertain; no send based on a failed receipt query. |
| Existing commitment has a different window | Confirmed comparison gap: both window boundaries were omitted. | Compare every public commitment field, including reporter and both boundaries. |
| Matching commitment with no saved transaction | Confirmed confirmation-depth gap: the no-hash path confirmed immediately. | Require reconciliation; do not invent receipt provenance or confirmation depth. |
| Persisted transaction differs from the intended batch/domain | No full signed-byte validation before reuse. | Check complete tuple, signature sender, hash, chain, nonce, destination, exact calldata and zero value; stop on mismatch. |
| Lease expires while preparing, broadcasting or finalizing | Some writes checked only worker ID, preparation wrote unconditionally, and no terminal write checked expiry. | Per-claim token and post-lock PostgreSQL time fence all preparation/status writes and broadcast admission. |
| Nonce pending or consumed without matching commitment | Baseline could rebroadcast a known pending transaction or repeatedly retry an obsolete nonce. | Wait for pending work; retain a diagnostic for an unknown pending replacement; require reconciliation if the nonce was consumed without the intended commitment. |
| Transaction mines between successive RPC reads | Sequential mutable-chain reads could combine an old empty commitment with a new receipt/nonce and falsely terminalize reconciliation. | Use one block context for commitment, receipt-depth and confirmed nonce decisions. |
| Shallow reverted inclusion disappears in rollback | Immediate terminal failure ignored the configured confirmation depth for reverted receipts. | Keep it retryable until the revert reaches the same required depth as a success. |

The first 19-case baseline run, using only the new RPC injection boundary with the old worker logic, observed seven passes and twelve failures. Not every failed assertion represented a separate correctness defect: several exposed missing diagnostics or lease-release behavior. Persist-before-broadcast, basic publication, normal dropped-transaction byte reuse, configured publisher mismatch and wrong-chain checks were existing strengths.

## REASON and DECIDE — one operation, explicit uncertainty

Goal chain: recover publication after ordinary faults → preserve exactly one logical commitment per batch → export evidence whose chain status is supported by read-back. Facts: signed transaction bytes determine hash, sender, nonce and target; the registry is append-only per batch key; an RPC send can succeed before its reply is lost. Constraints: preserve the existing schema/statuses, separate evidence/agreement wallets and nonce locks, agreement-version binding, authorization and monitoring behavior.

Keep the existing status enum. `PENDING` without bytes means unsigned work. `PENDING` with a complete persisted transaction means prepared work whose submission may be unknown. `SUBMITTED` means a broadcast was acknowledged or the operation was observed on chain/in the mempool; it is not finality. Only a successful canonical receipt, complete matching read-back and sufficient depth admit `CONFIRMED`. An included revert reaches `FAILED` only after the configured depth. Conflicting durable data, a consumed unknown nonce, mismatching commitment, changed publication configuration or an unattributable existing commitment goes to `RECONCILIATION_REQUIRED` with a specific reason.

Reject allocating a new nonce on an uncertain send: it creates another transaction and can strand the original nonce. Reject replacing signed bytes or automatically fee-bumping: the existing schema records one operation, not a replacement lineage. Reject holding a database transaction across RPC calls: network stalls would hold locks/connections and make lease recovery less reliable. Estimate gas and query fee/pending nonce outside the nonce-allocation transaction; under the advisory lock, check current lease authority, choose the next reserved nonce and persist the locally signed transaction atomically.

The evidence key must remain dedicated. Out-of-band wallet transactions can consume a reserved nonce; the worker detects this and pauses for reconciliation rather than silently spending another nonce. A signed-but-unsent earlier operation can delay later nonces. A poll considers at most ten distinct intents so a waiting item does not monopolize that entire pass. It does not provide unlimited queue throughput or automatic fee replacement.

## IMPLEMENT — invariants and recovery states

| Persisted state | Expected next action |
| --- | --- |
| Active lease after process loss | Leave ownership intact until lease expiry; a restart cannot take it early. |
| `PENDING`, no bytes | Validate context and prepare once under the nonce lock. |
| `PENDING`/`SUBMITTED`, valid bytes, no canonical receipt and no known transaction, nonce unused | Admit broadcast only with a live lease and send those exact bytes again. |
| Known pending transaction | Wait; do not resend or allocate a new nonce. |
| Unknown pending replacement | Wait with `evidence_nonce_pending_unknown`; no replacement transaction is created. |
| Canonical successful receipt, exact commitment, sufficient depth | Atomically record `CONFIRMED`, confirmation time, cleared lease and cleared error. |
| Canonical reverted receipt below depth | Remain retryable with `evidence_confirmations_pending`. |
| Canonical reverted receipt at depth | Record `FAILED/evidence_transaction_reverted`; retain the transaction tuple. |
| PostgreSQL write fails after broadcast/inclusion | The saved operation remains authoritative. Reconcile the existing transaction after recovery; never allocate another nonce for it. |
| Failure recording also fails | Retain the leased intent and tuple until PostgreSQL returns and the lease can be reclaimed. |
| Stale worker completes after takeover | Reject its state write; it cannot overwrite the new owner, terminal state or transaction tuple. |

Every claim has a fresh token. Preparation and terminal writes acquire the intent row lock, then check token, nonterminal status and `clock_timestamp()`. The short database transaction holds that lock through commit. Preparation also uses the existing evidence-only advisory nonce lock; all network I/O occurs outside it. Broadcast admission performs the same current-authority check immediately before sending.

Each processing pass captures one latest block number/hash. Commitment and confirmed-nonce reads use that block number; receipt depth is calculated against the same head. A receipt included after that snapshot is deferred to a later poll, not interpreted as a conflicting empty commitment. Canonical receipt block and snapshot head hashes are checked before accepting receipt outcomes, and snapshot identity is rechecked before terminal existing-commitment/consumed-nonce conflict decisions. Pending-nonce reads describe uncertainty and cannot prove a terminal conflict by themselves.

A lease cannot recall an RPC request already in flight. A late worker may therefore finish sending bytes after takeover; both owners can only send the same immutable operation. Ethereum transaction hash/nonce and the registry's unique batch key prevent another logical publication, while PostgreSQL fencing prevents stale status changes. This is idempotent recovery, not an exactly-once network-send guarantee.

Signed-byte validation is bound to the currently configured registry/chain and immutable batch calldata. Publisher rotation is checked separately from historical reporter identity: a valid included transaction can be confirmed using its persisted sender after rotation; unpublished work with mismatched current publisher configuration is paused. No private key, serialized transaction or endpoint is included in worker diagnostics.

Confirmation depth is a bounded confidence policy, not mathematical finality. This worker does not continuously rescan already terminal `CONFIRMED`/`FAILED` intents for deeper reorganizations, tolerate a Byzantine RPC, replace stuck transactions, repair database corruption or provide an operator reconciliation UI. Those remain operational limitations.

## VERIFY — isolated PostgreSQL and EVM

From `backend/`, choose an absolute artifact directory:

````powershell
npm run test:evidence-reliability -- --output "C:\absolute\artifacts"
npm run test:phase2c-acceptance -- --output "C:\absolute\artifacts"
npm run test:monitoring-reliability -- --output "C:\absolute\artifacts"
````

The publisher mode reuses the [Gate 2 isolation runner](phase2c-acceptance.md): two new `phase2c_<random>_test` databases, two fresh local EVM processes, real registry deployment and real migrations. Docker PostgreSQL 17 is the default; the guarded local `TEST_DATABASE_URL`/CREATEDB option also works. The supplied database is never reset. Cleanup drops only owned databases, stops owned EVM/container processes and removes isolated child homes. Safe logs remain at the requested output directory and are uploaded by CI.

Each publisher case owns its relational fixtures and an EVM snapshot; hooks explicitly restore automine because a snapshot revert alone does not restore that node setting. Measurements/signatures are not fabricated as runtime fallbacks: these fixtures seed minimal immutable batch/version rows with synthetic roots to isolate publication behavior. [Gate 2](phase2c-acceptance.md) separately proves authenticated signing, source authorization, real package construction/verification and version isolation through the API.

RPC faults are injected through the production-default client factory. Successful transactions, receipts, registry storage, dropped/replacement transactions, mining/confirmation depth and chain rollback use the real local EVM. PostgreSQL `40001` trigger faults test preparation, post-broadcast status, confirmation and failure-recording rollback. Real child processes are killed at the send boundary before and after inclusion. Promise barriers, database time and `pg_blocking_pids` prove lock waits without arbitrary sleeps or timeout inflation. No Fuji endpoint, public probe, unsafe SSRF exception or paid network is involved.

The child-process fixtures also stop and await their child when Node cancels a timed-out test, preventing it from claiming a later case's fixture. The inherited Gate 3A crash fixture receives the same cancellation cleanup. During local parallel checks, PostgreSQL startup missed its existing readiness bound and process fixtures hit their existing 15-second deadline under measured memory pressure; these attempts are not counted as passes. Final acceptance must use the sequential reruns and hosted CI results, not those partial attempts.

Local verification on 2026-10-30: the initial 46-case matrix passed in each of two fresh PostgreSQL/EVM environments with zero skips. Independent review then produced three regression cases: two ordinary mid-poll inclusion races and a shallow reverted-receipt rollback; all three failed against the earlier implementation and passed after the fixed-block/depth correction. The final 49-case local run reported 47 passes, zero assertion failures and two process-fixture cancellations at the unchanged 15-second deadline. The cancellation hooks stopped those owned children, and later concurrency cases passed. These cancellations are not passes. Backend build, lint/typecheck before the final additions, and 42 existing unit tests passed. The parallel Gate 2 attempt missed PostgreSQL readiness; Gate 3A passed its first 24-case run but its second run cancelled the process fixture. Use the GitHub Actions run for the exact feature commit as the final whole-suite verdict: it runs Gate 2, Gate 3A and all 49 publisher cases twice in isolated environments and retains the individual safe logs. No local timeout or startup bound was extended.

Changed files: `backend/src/monitoring/evidence-anchor-worker.service.ts` owns the durable operation, lease and finality changes; `monitoring.module.ts` binds the production RPC factory; `backend/test/integration/evidence-publisher.integration.test.ts` owns the 49-case fault matrix; `monitoring-worker.integration.test.ts` adds cancellation cleanup to the inherited process fixture. `backend/scripts/run-phase2c-acceptance.mjs`, `backend/package.json` and `.github/workflows/phase2a.yml` expose/run the isolated publisher mode. `docs/arch/phase2c-monitoring.md`, `docs/index.md`, `docs/plan/phase2c-oracle-evidence.md`, both prior gate references, this reference and `CHANGELOG.md` synchronize policy, diagnostics and remaining acceptance work. No Prisma model/migration, contract, authorization handler, HTTP probe protection or agreement relayer implementation changes.

## TEACH BACK — diagnostics and operations

The worker logs an intent ID and an allowlisted reason, never raw RPC error text. Representative reasons are `evidence_rpc_timeout`, `evidence_rpc_unavailable`, `evidence_rpc_rejected`, `evidence_database_P2034`, `evidence_confirmations_pending`, `evidence_receipt_noncanonical`, `evidence_persisted_transaction_mismatch`, `evidence_commitment_mismatch`, `evidence_nonce_pending_unknown`, `evidence_nonce_consumed_without_commitment`, `evidence_publisher_configuration_mismatch` and `evidence_commitment_without_transaction`. A stale writer logs `lease_lost_or_intent_terminal` and changes nothing.

This read-only diagnostic deliberately excludes signed bytes and ownership tokens:

````sql
SELECT intent."id", intent."batchId", intent."anchorKey", intent."status", intent."attemptCount",
       intent."transactionChainId", intent."relayerAddress", intent."relayerNonce", intent."transactionHash",
       intent."lastError", intent."leaseUntil", intent."submittedAt", intent."confirmedAt",
       (intent."signedTransaction" IS NOT NULL) AS "hasSignedTransaction",
       (intent."leaseUntil" IS NULL OR intent."leaseUntil" <= clock_timestamp()) AS "claimableLease",
       batch."agreementId", batch."agreementVersion", batch."merkleRoot", batch."batchDigest"
FROM "EvidenceAnchorIntent" intent
JOIN "EvidenceBatch" batch ON batch."id" = intent."batchId"
ORDER BY intent."createdAt", intent."id";
````

Inspect pending work against the exact chain/registry, saved transaction receipt and complete commitment. Resolve transport/database availability before changing durable state. Do not clear transaction bytes, change a reserved nonce, delete a conflict or mark an intent confirmed to silence diagnostics. Reconciliation is intentionally terminal to automatic polling; resolving it requires an explicit operator decision backed by chain evidence.

Gate 3B does not add a main merge or Fuji deployment. Dedicated authenticated monitoring-management browser journeys and a real public-endpoint observation scenario remain separate acceptance work; existing signing and responsive monitoring regressions must continue to pass.
