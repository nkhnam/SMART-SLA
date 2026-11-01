export const evidenceRegistryAbi = [
  { type: "function", name: "publisher", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "commitEvidence", stateMutability: "nonpayable", inputs: [
    { name: "batchKey", type: "bytes32" }, { name: "agreementVersionKey", type: "bytes32" }, { name: "merkleRoot", type: "bytes32" }, { name: "batchDigest", type: "bytes32" }, { name: "schemaVersionHash", type: "bytes32" },
    { name: "agreementVersion", type: "uint64" }, { name: "windowStart", type: "uint64" }, { name: "windowEnd", type: "uint64" }
  ], outputs: [] },
  { type: "function", name: "getCommitment", stateMutability: "view", inputs: [{ name: "batchKey", type: "bytes32" }], outputs: [{ name: "commitment", type: "tuple", components: [
    { name: "agreementVersionKey", type: "bytes32" }, { name: "merkleRoot", type: "bytes32" }, { name: "batchDigest", type: "bytes32" }, { name: "schemaVersionHash", type: "bytes32" }, { name: "agreementVersion", type: "uint64" },
    { name: "windowStart", type: "uint64" }, { name: "windowEnd", type: "uint64" }, { name: "reporter", type: "address" }, { name: "committedAt", type: "uint64" }
  ] }] },
  { type: "event", name: "EvidenceCommitted", anonymous: false, inputs: [
    { indexed: true, name: "batchKey", type: "bytes32" }, { indexed: true, name: "agreementVersionKey", type: "bytes32" }, { indexed: true, name: "merkleRoot", type: "bytes32" }, { indexed: false, name: "batchDigest", type: "bytes32" },
    { indexed: false, name: "schemaVersionHash", type: "bytes32" }, { indexed: false, name: "agreementVersion", type: "uint64" }, { indexed: false, name: "windowStart", type: "uint64" }, { indexed: false, name: "windowEnd", type: "uint64" }, { indexed: false, name: "reporter", type: "address" }
  ] }
] as const;
