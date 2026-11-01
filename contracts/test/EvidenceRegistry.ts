import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { zeroHash } from "viem";

describe("EvidenceRegistry", async () => {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [publisher, secondPublisher] = await viem.getWalletClients();
  const registry = await viem.deployContract("EvidenceRegistry", [publisher.account.address]);

  it("accepts a minimal evidence commitment and allows independent read-back", async () => {
    const batchKey = `0x${"11".repeat(32)}` as const;
    const root = `0x${"22".repeat(32)}` as const;
    const batchDigest = `0x${"33".repeat(32)}` as const;
    const agreementVersionKey = `0x${"44".repeat(32)}` as const;
    const schemaHash = `0x${"55".repeat(32)}` as const;
    const txHash = await registry.write.commitEvidence([batchKey, agreementVersionKey, root, batchDigest, schemaHash, 2n, 1_800_000_000n, 1_800_086_400n]);
    assert.equal((await publicClient.waitForTransactionReceipt({ hash: txHash })).status, "success");
    const result = await registry.read.getCommitment([batchKey]);
    assert.equal(result.merkleRoot, root);
    assert.equal(result.batchDigest, batchDigest);
    assert.equal(result.agreementVersionKey, agreementVersionKey);
    assert.equal(result.reporter.toLowerCase(), publisher.account.address.toLowerCase());
    assert.equal(result.agreementVersion, 2n);
  });

  it("rejects empty, invalid-window, duplicate, and zero-root commitments", async () => {
    const args = [`0x${"44".repeat(32)}`, `0x${"55".repeat(32)}`, `0x${"66".repeat(32)}`, `0x${"77".repeat(32)}`, `0x${"88".repeat(32)}`, 1n, 1_800_000_000n, 1_800_000_001n] as const;
    await assert.rejects(registry.write.commitEvidence([zeroHash, ...args.slice(1)]));
    await assert.rejects(registry.write.commitEvidence([args[0], zeroHash, ...args.slice(2)]));
    await assert.rejects(registry.write.commitEvidence([args[0], args[1], zeroHash, ...args.slice(3)]));
    await assert.rejects(registry.write.commitEvidence([args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[6]]));
    await assert.rejects(secondPublisher.writeContract({ address: registry.address, abi: registry.abi, functionName: "commitEvidence", args }));
    const txHash = await registry.write.commitEvidence([...args]);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    await assert.rejects(registry.write.commitEvidence([...args]));
    assert.notEqual(publisher.account.address, secondPublisher.account.address);
  });
});
