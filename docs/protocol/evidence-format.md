# SLA-DEX Evidence Format v1

An export is an independent proof package, not a claim that the measurement source was honest.

## Canonical JSON

Encode as UTF-8 JSON. Normalize all string values and object keys to Unicode NFC. Sort object keys by UTF-8 byte order. Keep array order. Encode only null, booleans, strings, arrays, objects, and safe integer numbers. Timestamps use UTC ISO-8601 strings. Duplicate keys after normalization and non-integer numbers are invalid.

## Merkle construction

Sort records by `(observedAt, observationId)`. For each canonical record, compute `leaf = keccak256(0x00 || recordBytes)`. Pair adjacent nodes as `parent = keccak256(0x01 || left || right)`. When a level has an odd node count, pair the last node with itself. Continue until one root remains. An inclusion proof contains the sibling digest at each level and the record's zero-based index; index parity determines sibling ordering.

## Manifest and verification

The canonical manifest contains schema version, agreement ID, immutable agreement version, signing snapshot hash, window start/end, KPI algorithm version, evaluated KPI values and breach states, observation count, Merkle root, and the ordered `(index, observationId, leafDigest)` list. `batchDigest = keccak256(canonicalManifestBytes)`. The package includes each normalized record and its inclusion proof. A verifier recomputes every leaf, checks every proof against the root, recomputes the manifest digest, and compares root and digest with the `EvidenceRegistry` read-back. Run the API-independent package verifier with `npm run verify:evidence -- <evidence-export.json>` from `backend/`; compare its root and digest to the public `getCommitment(batchKey)` contract read separately.

## Privacy and limits

The commitment excludes endpoint URLs, webhook secrets, raw provider payloads, SLA prose, and personal information. Exported records include measurement provenance and normalized values. Verification establishes integrity relative to the publisher's commitment, not the truth, independence, or legal effect of the measurements.
