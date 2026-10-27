# Agreement Snapshot Hashing Protocol

## Version 1

The API stores a frozen version-1 snapshot as canonical UTF-8 JSON and computes `keccak256(UTF8(canonicalJson))`. The same bytes are shown to both signers. EIP-712 signatures bind that digest to a version-specific agreement key, both organizations, both signer addresses, nonce, expiry, chain ID and registry address.

### Canonical fields and order

The JSON object uses exactly these keys in this order:

````json
{"schemaVersion":"sla-dex-agreement-snapshot/1","agreementId":"3ebf6e45-1c81-4e68-9510-13c6cfb6c9a7","reference":"SLA-2026-001","version":1,"buyerOrganizationId":"0b847a83-7b9f-4c99-8803-7e7607a1e228","supplierOrganizationId":"b0f2af02-399f-4bd2-b8cb-1c818de6d4fc","name":"Café SLA","serviceDescription":"Managed platform","uptimeTargetBasisPoints":9995,"responseTimeTargetMs":180,"measurementWindowHours":24,"exclusions":["force majeure","maintenance"],"notes":null,"buyerSigner":"0x0000000000000000000000000000000000000001","supplierSigner":"0x0000000000000000000000000000000000000002","validUntil":1799999999}
````

Normalization rules:

- UUIDs are validated and lower-case; addresses are validated and checksum-normalized.
- Human-entered strings are Unicode NFC-normalized and trimmed at the outside. Internal whitespace and letter case are preserved. Blank optional notes become `null`.
- Exclusions are NFC-normalized, trimmed, and sorted by lexicographic UTF-8 bytes. Duplicate values are retained. An empty list is valid.
- `uptimeTargetBasisPoints` is an integer from 1 through 10000 (`99.95%` is `9995`). Response target is integer milliseconds; measurement window is integer hours. Floats are invalid.
- `version` and `validUntil` are positive safe integers; the API serializes them as JSON decimal integers. `validUntil` is Unix seconds and also equals the EIP-712 `deadline`.
- JSON uses UTF-8, no BOM, no indentation, and `JSON.stringify` property order above. Null notes are emitted explicitly. Missing keys are invalid.

### Snapshot hash and version key

For the example above, hash the exact UTF-8 JSON bytes shown above. The implementation fixture is:

````text
0x6059588811b83299b5dca027af37339af5978167d4cab83ef8ee8b025351ccb8
````

The key is a separate value for each agreement version:

````text
agreementIdHash = keccak256(UTF8(lowercase(agreementId)))
agreementKey = keccak256(abi.encode(bytes32 agreementIdHash, uint64 version))
````

This permits separately anchoring a later amendment without editing a previous on-chain record. A contract rejects a second registration for the same version key.

### EIP-712 message

Domain:

| Field | Value |
|---|---|
| `name` | `SLA-DEX Agreement Registry` |
| `version` | `1` |
| `chainId` | configured chain; Fuji is `43113` |
| `verifyingContract` | deployed registry address |

Primary type:

````text
AgreementApproval(bytes32 agreementKey,bytes32 agreementHash,uint64 version,bytes32 buyerOrganization,bytes32 supplierOrganization,address buyerSigner,address supplierSigner,uint256 nonce,uint64 deadline)
````

Organization references in the typed message are `keccak256(UTF8(lowercase(organization UUID)))`. The version-specific key and snapshot hash are the values above. The selected Buyer and Supplier wallet addresses must match the authorized signer records and recovered signatures. The deadline must equal the snapshot's `validUntil`. Signatures are EOA ECDSA; ERC-1271 is unsupported.

### Usage

`backend/src/blockchain/agreement-hash.service.ts` owns normalization, canonical field order, snapshot hashing, key derivation and EIP-712 payload construction. Contract verification independently reconstructs the typed-data struct hash using OpenZeppelin EIP712 and ECDSA. Any schema change requires a new `schemaVersion` and protocol/domain compatibility decision; never reinterpret a stored version-1 snapshot.
