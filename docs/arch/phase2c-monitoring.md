# Phase 2C Oracle Monitoring and Evidence

## Scope

Phase 2C collects measurements for an exact immutable agreement version, evaluates the signed uptime and response-time targets, and creates a portable integrity package. It does not resolve disputes, transfer money, or establish that a measurement is truthful.

Monitoring configuration is available only to OWNER/ADMIN members of an accepted agreement party. The agreement must be bilaterally signed, frozen, and confirmed on the currently configured chain. Sources and observations retain the exact agreement version; an amendment never rewrites them.

## Collection

HTTP probes use a fixed GET request, 5-second timeout, 64 KiB response cap, standard ports, public-address DNS pinning, and redirect revalidation. Redirects cannot downgrade HTTPS. The response body is discarded. DNS answers containing any private or reserved address are rejected. A database lease and `FOR UPDATE SKIP LOCKED` claim one due source across workers; every scheduled run has a uniqueness key. Probe failures are stored as categorized observations and do not stop the API.

Signed webhooks authenticate HMAC-SHA256 over the raw JSON body and the timestamp, nonce, and event ID headers. HMAC comparison is constant-time. The server encrypts generated secrets with AES-256-GCM and the configured 32-byte `MONITORING_SECRET_ENCRYPTION_KEY`; a secret is returned only when created or rotated. Events are freshness-limited to five minutes, size-limited to 64 KiB, throttled to 30 requests per minute, and protected by unique nonce and idempotency keys. Provider reports are labeled `PROVIDER_REPORTED`; they are not described as independent measurements.

## Evaluation

`sla-dex-kpi/1` constructs the expected sample grid from the measurement interval and window. A scheduled slot without a valid observation is `unknown`; it is never turned into uptime or downtime. Coverage is valid slots divided by expected slots. Uptime is healthy divided by valid healthy-plus-failed slots, but is exposed only at 80% coverage. Lower coverage produces `INSUFFICIENT_DATA`. Latency is the arithmetic mean of available valid latency values; the signed SLA does not specify a percentile. A crossed target produces `BREACH_CANDIDATE`, not an adjudicated breach. Free-text exclusions are not interpreted automatically.

Evaluations are idempotent per source, window, and algorithm version. The UI compares only evaluations from the selected agreement version with identical window boundaries. It shows per-source coverage, trust category and health result, along with coverage, uptime and arithmetic-mean latency differences. Fewer than two overlapping sources, coverage below 80%, or unavailable health results produces `INSUFFICIENT_COMPARISON`. Otherwise equal values produce `AGREEMENT` and differing values produce `DISAGREEMENT`. A disagreement is for review and does not imply manipulation or fraud.

Free-text exclusions are unsupported calculation inputs. The KPI engine does not interpret them as maintenance windows. Any future structured exclusion must be authorized for the exact signed agreement version, preserve an immutable audit trail and cannot retroactively change an anchored snapshot.

Phase 2C.1 verification status: the pending-counterparty signing request is suppressed in the UI, the inherited duplicate-signature conflict is asserted as a scoped expected `409`, the signer test waits for wallet verification, frontend source-comparison boundaries have tests, and a basic responsive live-workspace empty-state browser case is defined. A controlled PostgreSQL-to-local-EVM monitoring demo, monitoring worker concurrency/restart tests, evidence publisher fault matrix and hosted browser result remain required before acceptance.

## Evidence format

The export uses `sla-dex-evidence/1`, UTF-8 canonical JSON with NFC-normalized strings, UTF-8-sorted object keys, safe integer numbers, and ISO-8601 UTC timestamps. A leaf digest is `keccak256(0x00 || canonicalRecordBytes)`. An internal node is `keccak256(0x01 || leftDigest || rightDigest)`; an unpaired final node is paired with itself. Record order is observation time then observation ID, and each record includes its index and sibling digests.

The manifest binds agreement ID and immutable version, window boundaries, algorithm version, observation count, Merkle root, and the ordered observation digests. The batch digest is keccak256 of that canonical manifest. The exported verifier recomputes every leaf and proof from the package. The hash proves package integrity relative to the registered commitment; it cannot prove that the original measurement was accurate.

The chain stores no endpoint URL, provider payload, SLA text, user identity, or observation body. `EvidenceRegistry` records a unique batch key, version key, Merkle root, batch digest, schema hash, window, reporter, and chain timestamp. Only the configured publisher can commit. The owner can rotate the publisher. That permission identifies an allowed reporter; it does not make the reporter a universally trusted oracle.

Interpret the resulting proof in separate layers: measurement truth concerns whether the service behaved as recorded; source provenance identifies who or what reported and collected a value; evidence integrity establishes that exported records match their Merkle commitment; an on-chain commitment records the publisher's root and public metadata; agreement signing binds the parties to an immutable SLA version. None of the latter three independently proves objective measurement truth.

## Relayer and retention

Evidence uses a separately configured publisher account and PostgreSQL nonce lock `8273642`; Phase 2B AgreementRegistry uses lock `8273641`. Before broadcast, the worker persists the signed transaction, chain ID, nonce, sender, and hash. Retries rebroadcast those same signed bytes. It confirms only after a successful receipt, configured confirmation depth, and matching registry read-back. Conflicting chain state is marked for reconciliation.

Unanchored observations expire after each source's configured retention interval (default 90 days). A daily cleanup deletes expired observations only if no evidence record references them. Evidence records and their observations remain available after inclusion in an evidence batch. `MonitoringRun` operational metadata is retained separately.

## Configuration

`EVIDENCE_RPC_URL`, `EVIDENCE_CHAIN_ID`, `EVIDENCE_REGISTRY_ADDRESS`, and `EVIDENCE_RELAYER_PRIVATE_KEY` are required together to activate the publisher worker. `EVIDENCE_CONFIRMATIONS` controls read-back depth. Monitoring collection can be used without an evidence registry, but anchoring remains pending until this configuration is present.
