import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAnchorRecovery } from "../../src/blockchain/anchor-recovery.js";

describe("anchor transaction recovery", () => {
  it("requires full proof evaluation for a matching registry record", () => {
    assert.equal(resolveAnchorRecovery({ registry: "matching", receipt: "missing", transaction: "missing", pendingNonce: 4n, relayerNonce: 3n }), "EVALUATE_PROOF");
  });

  it("requires manual reconciliation when the registered agreement differs", () => {
    assert.equal(resolveAnchorRecovery({ registry: "mismatch", receipt: "missing", transaction: "missing", pendingNonce: 4n, relayerNonce: 3n }), "MANUAL_RECONCILIATION");
  });

  it("waits for the already broadcast transaction after an RPC timeout", () => {
    assert.equal(resolveAnchorRecovery({ registry: "missing", receipt: "missing", transaction: "present", pendingNonce: 4n, relayerNonce: 3n }), "WAIT_FOR_RECEIPT");
  });

  it("rebroadcasts the persisted transaction only while its nonce remains unused", () => {
    assert.equal(resolveAnchorRecovery({ registry: "missing", receipt: "missing", transaction: "missing", pendingNonce: 3n, relayerNonce: 3n }), "REBROADCAST_SAME_TRANSACTION");
  });

  it("requires reconciliation when the relayer nonce was consumed without the expected registry record", () => {
    assert.equal(resolveAnchorRecovery({ registry: "missing", receipt: "missing", transaction: "missing", pendingNonce: 4n, relayerNonce: 3n }), "MANUAL_RECONCILIATION");
  });

  it("requires canonical proof and depth for a reverted receipt", () => {
    assert.equal(resolveAnchorRecovery({ registry: "missing", receipt: "reverted", transaction: "present", pendingNonce: 4n, relayerNonce: 3n }), "EVALUATE_PROOF");
  });

  it("requires registry read-back after a successful receipt", () => {
    assert.equal(resolveAnchorRecovery({ registry: "missing", receipt: "success", transaction: "present", pendingNonce: 4n, relayerNonce: 3n }), "EVALUATE_PROOF");
  });
});
