import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertDeployerIdentity, assertDeploymentTarget, getFujiRoles, matchesRuntimeBytecode } from "../scripts/deployment-policy.js";

const roles = {
  FUJI_DEPLOYER_ADDRESS: "0x1000000000000000000000000000000000000001",
  AGREEMENT_RELAYER_ADDRESS: "0x2000000000000000000000000000000000000002",
  EVIDENCE_PUBLISHER_ADDRESS: "0x3000000000000000000000000000000000000003",
  BUYER_SIGNER_ADDRESS: "0x4000000000000000000000000000000000000004",
  SUPPLIER_SIGNER_ADDRESS: "0x5000000000000000000000000000000000000005"
};

describe("deployment admission", () => {
  it("rejects mainnet, unexpected chains and disguised network names before deployment", () => {
    for (const [networkName, chainId] of [["avalancheFuji", 43114], ["avalancheFuji", 1], ["localEvm", 43113], ["hardhatMainnet", 43114], ["mainnet", 43113], ["default", 31337]] as const) {
      assert.throws(() => assertDeploymentTarget(networkName, chainId, { ...roles, FUJI_DEPLOYMENT_APPROVED: "43113" }), /Deployment target rejected/);
    }
  });

  it("requires a separate exact Fuji approval and complete public role configuration", () => {
    assert.throws(() => assertDeploymentTarget("avalancheFuji", 43113, roles), /FUJI_DEPLOYMENT_APPROVED/);
    assert.throws(() => assertDeploymentTarget("avalancheFuji", 43113, { FUJI_DEPLOYMENT_APPROVED: "43113" }), /FUJI_DEPLOYER_ADDRESS/);
    assert.doesNotThrow(() => assertDeploymentTarget("avalancheFuji", 43113, { ...roles, FUJI_DEPLOYMENT_APPROVED: "43113" }));
  });

  it("allows only the two existing local targets at chain 31337 without Fuji roles or approval", () => {
    assert.doesNotThrow(() => assertDeploymentTarget("hardhatMainnet", 31337, {}));
    assert.doesNotThrow(() => assertDeploymentTarget("localEvm", 31337, {}));
  });

  it("rejects zero, missing, malformed or overlapping Fuji role identities", () => {
    assert.throws(() => getFujiRoles({ ...roles, EVIDENCE_PUBLISHER_ADDRESS: roles.FUJI_DEPLOYER_ADDRESS }), /distinct/);
    assert.throws(() => getFujiRoles({ ...roles, SUPPLIER_SIGNER_ADDRESS: roles.BUYER_SIGNER_ADDRESS }), /distinct/);
    assert.throws(() => getFujiRoles({ ...roles, AGREEMENT_RELAYER_ADDRESS: "0x0000000000000000000000000000000000000000" }), /nonzero/);
    assert.throws(() => getFujiRoles({ ...roles, FUJI_DEPLOYER_ADDRESS: "invalid" }), /FUJI_DEPLOYER_ADDRESS/);
    assert.throws(() => getFujiRoles({ ...roles, EVIDENCE_PUBLISHER_ADDRESS: undefined }), /EVIDENCE_PUBLISHER_ADDRESS/);
    assert.equal(getFujiRoles(roles).evidencePublisher, roles.EVIDENCE_PUBLISHER_ADDRESS);
  });

  it("rejects a deployer key whose public identity differs from the approved role", () => {
    assert.throws(() => assertDeployerIdentity(43113, roles.AGREEMENT_RELAYER_ADDRESS, roles), /does not match/);
    assert.doesNotThrow(() => assertDeployerIdentity(43113, roles.FUJI_DEPLOYER_ADDRESS, roles));
  });

  it("matches runtime bytecode only outside compiler-declared immutable slots", () => {
    assert.equal(matchesRuntimeBytecode("0x6001aabb6002", "0x600100006002", { "1": [{ start: 2, length: 2 }] }), true);
    assert.equal(matchesRuntimeBytecode("0x6001aabb6003", "0x600100006002", { "1": [{ start: 2, length: 2 }] }), false);
    assert.equal(matchesRuntimeBytecode("0x", "0x6002", {}), false);
    assert.equal(matchesRuntimeBytecode("0x6002", "0x6003", {}), false);
  });
});
