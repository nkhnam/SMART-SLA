# SLA-DEX Evidence Format v1

An export is an independent proof package, not a claim that the measurement source was honest.

## Canonical JSON

Encode as UTF-8 JSON. Normalize all string values and object keys to Unicode NFC. Sort object keys by UTF-8 byte order. Keep array order. Encode only null, booleans, strings, arrays, objects, and safe integer numbers. Timestamps use UTC ISO-8601 strings. Duplicate keys after normalization and non-integer numbers are invalid.

## Merkle construction

Sort records by `(observedAt, observationId)`. For each canonical record, compute `leaf = keccak256(0x00 || recordBytes)`. Pair adjacent nodes as `parent = keccak256(0x01 || left || right)`. When a level has an odd node count, pair the last node with itself. Continue until one root remains. An inclusion proof contains the sibling digest at each level and the record's zero-based index; index parity determines sibling ordering.

## Manifest and verification

The canonical manifest contains schema version, agreement ID, immutable agreement version, signing snapshot hash, window start/end, KPI algorithm version, evaluated KPI values and breach states, observation count, Merkle root, and the ordered `(index, observationId, leafDigest)` list. `batchDigest = keccak256(canonicalManifestBytes)`. The package includes each normalized record and its inclusion proof. A verifier recomputes every leaf, checks every proof against the root, recomputes the manifest digest, and compares root and digest with the `EvidenceRegistry` read-back. Run the API-independent package verifier with `npm run verify:evidence -- <evidence-export.json>` from `backend/`; compare its root and digest to the public `getCommitment(batchKey)` contract read separately.

## Window membership and frozen KPI values

Evidence selects records whose `scheduledFor` is in `(windowStart, windowEnd]` for the exact signed agreement version. A delayed HTTP probe can therefore have an `observedAt` after the window end; its original measurement timestamp is retained. Merkle ordering remains `(observedAt, observationId)`.

The first saved KPI result for a source, window and algorithm is immutable. Before creating a new batch, the server recomputes every included evaluation from the selected records, the source's immutable timing configuration and the signed SLA targets. It rejects a batch if any stored metric, state or algorithm disagrees. Existing batches retain their original records and commitments. Later observations require another completed evaluation window when they change the frozen result.

Historical evaluation input IDs are not stored. This consistency check establishes that the selected records reproduce the packaged numbers; it does not establish their exact original membership. The portable verifier checks hashes and inclusion proofs, rather than independently replaying numerical KPI calculations.

## Privacy and limits

The commitment excludes endpoint URLs, webhook secrets, raw provider payloads, SLA prose, and personal information. Exported records include measurement provenance and normalized values. Verification establishes integrity relative to the publisher's commitment, not the truth, independence, or legal effect of the measurements.

## Measurement and exclusions

Measurement truth, source provenance, evidence integrity, an on-chain commitment, and agreement signing are distinct claims. A valid Merkle proof shows that package records match the committed root; it does not establish that a probe or provider report reflects objective service behavior. The chain records the publisher's commitment, while agreement signatures bind the parties to the canonical SLA snapshot.

Free-text exclusions are not machine-verifiable maintenance semantics and are not applied to KPI calculations. Structured exclusions remain unsupported. A future implementation must bind each exclusion to explicit authorization for the signed agreement version, preserve immutable audit history, and reject retroactive changes to an anchored version.
