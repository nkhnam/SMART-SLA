# Oracle Monitoring Threat Model

## Assets

The system protects session and organization boundaries, webhook credentials, the immutable signing snapshot, monitoring provenance, stored observations, evidence packages, and the separate evidence publisher key.

## Controls

- Source setup requires OWNER/ADMIN membership in one of the two accepted parties and an active bilateral signed snapshot with confirmed chain read-back.
- Every source, run, observation, evaluation, evidence batch, and anchor intent is bound to an agreement version.
- Probe endpoints are restricted to HTTP/HTTPS on standard ports, DNS results are validated and pinned per request, and every redirect is revalidated.
- Webhooks use encrypted secrets, raw-body HMAC, constant-time comparison, freshness, nonce and event uniqueness, a body cap, and a dedicated rate limit.
- Probe and anchor workers use durable PostgreSQL leases and idempotency constraints. Signed evidence transactions are stored before broadcast and retried using the same bytes.
- Evidence records prevent referenced observation deletion. Retention removes only expired observations not included in any evidence batch.
- Contract publisher access is explicit, append-only, and bound to a version key, unique batch key, Merkle root, schema hash, and reporter.

## Residual risks

An endpoint operator can return deceptive health responses. A provider can submit a false signed report. An operator with database or API access can delay collection, create misleading source configurations, or deny service. A compromised evidence publisher can anchor inaccurate roots, but cannot replace an existing batch key. A compromised database can alter data not yet committed; chain commitments and exported proofs expose changes to already committed packages. HMAC signatures identify possession of a provider secret, not independence. Availability, coverage, source disagreement, and breach candidates are measurements for review, not findings of fraud or adjudications.

The evidence publisher is a new operational trust boundary. Use a dedicated least-privilege wallet with funds limited to expected gas, protect it separately from the Phase 2B agreement relayer, monitor publisher changes, and independently read contract events and stored commitments.
