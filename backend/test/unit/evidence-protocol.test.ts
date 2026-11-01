import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMerkleEntries, canonicalJson, verifyEvidencePackage, verifyMerkleProof } from "../../src/monitoring/evidence-protocol.js";
import { keccak256, toBytes } from "viem";

describe("evidence protocol", () => {
  it("canonicalizes Unicode and object keys deterministically", () => {
    assert.equal(canonicalJson({ z: "e\u0301", a: 2 }), "{\"a\":2,\"z\":\"é\"}");
    assert.equal(canonicalJson({ a: 2, z: "é" }), canonicalJson({ z: "e\u0301", a: 2 }));
  });

  it("builds tamper-evident, index-bound proofs for odd leaf counts", () => {
    const { root, entries } = buildMerkleEntries([{ n: 1 }, { n: 2 }, { n: 3 }]);
    for (const entry of entries) assert.equal(verifyMerkleProof(entry.record, entry.index, entry.proof, root), true);
    assert.equal(verifyMerkleProof({ n: 4 }, 1, entries[1]!.proof, root), false);
    assert.equal(verifyMerkleProof(entries[0]!.record, 1, entries[0]!.proof, root), false);
  });

  it("rejects floating point values and empty batches", () => {
    assert.throws(() => canonicalJson({ metric: 1.25 }), /safe integers/);
    assert.throws(() => buildMerkleEntries([]), /at least one/);
  });

  it("verifies a standalone package manifest, digest, leaves, and proofs", () => {
    const records = [{ id: "a", uptime: 100 }, { id: "b", uptime: 99 }];
    const { root, entries } = buildMerkleEntries(records);
    const base = { schemaVersion: "sla-dex-evidence/1", observationCount: records.length, merkleRoot: root, records: entries.map(({ index, record, leafDigest }) => ({ index, observationId: record.id, leafDigest })) };
    const batchDigest = keccak256(toBytes(canonicalJson(base)));
    const exported = { manifest: { ...base, batchDigest }, records: entries.map(({ index, record, leafDigest, proof }) => ({ index, record, leafDigest, inclusionProof: proof })) };
    assert.equal(verifyEvidencePackage(exported), true);
    assert.equal(verifyEvidencePackage({ ...exported, records: [{ ...exported.records[0]!, record: { id: "a", uptime: 0 } }, exported.records[1]!] }), false);
  });
});
