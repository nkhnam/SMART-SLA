import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertDeployerIdentity, assertDeploymentTarget, getFujiRoles, getFujiExecutionPolicy, getFujiTransactionLimits, matchesRuntimeBytecode } from "../scripts/deployment-policy.js";
import { verifyDeployerIdentity } from "../scripts/deployer-identity.mjs";
import { artifacts, network } from "hardhat";
import { Readable } from "node:stream";
import { custom } from "viem";
import { readPrivateDeployerWallet } from "../scripts/private-deployer.js";
import { encodeDeployData, keccak256, type Hex } from "viem";

const roles = {
  FUJI_DEPLOYER_ADDRESS: "0x1000000000000000000000000000000000000001",
  AGREEMENT_RELAYER_ADDRESS: "0x2000000000000000000000000000000000000002",
  EVIDENCE_PUBLISHER_ADDRESS: "0x3000000000000000000000000000000000000003",
  BUYER_SIGNER_ADDRESS: "0x4000000000000000000000000000000000000004",
  SUPPLIER_SIGNER_ADDRESS: "0x5000000000000000000000000000000000000005"
};
const execution = { FUJI_GAS_PRICE_WEI: "1000000000", FUJI_AGREEMENT_GAS_LIMIT: "1200000", FUJI_EVIDENCE_GAS_LIMIT: "800000", FUJI_MAX_DEPLOYMENT_FEE_WEI: "2000000000000000", FUJI_DEPLOYER_START_NONCE: "0", FUJI_APPROVED_CONTRACT: "AgreementRegistry", FUJI_APPROVED_INITCODE_HASH: `0x${"a".repeat(64)}` };

describe("deployment admission", () => {
  it("derives only the approved identity from a public fixture key and rejects mismatches", () => {
    const fixture = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    assert.equal(verifyDeployerIdentity(fixture, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"), "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    assert.throws(() => verifyDeployerIdentity(fixture, roles.FUJI_DEPLOYER_ADDRESS), /identity mismatch/);
    assert.throws(() => verifyDeployerIdentity("seed words are not keys", roles.FUJI_DEPLOYER_ADDRESS), /Invalid private input/);
    assert.throws(() => verifyDeployerIdentity(`0x${"0".repeat(64)}`, roles.FUJI_DEPLOYER_ADDRESS), /Invalid private input/);
  });
  it("rejects Fuji deployment approval without explicit execution limits", () => {
    assert.throws(() => assertDeploymentTarget("avalancheFuji", 43113, { ...roles, FUJI_DEPLOYMENT_APPROVED: "43113" }), /FUJI_/);
  });
  it("rejects mainnet, unexpected chains and disguised network names before deployment", () => {
    for (const [networkName, chainId] of [["avalancheFuji", 43114], ["avalancheFuji", 1], ["localEvm", 43113], ["hardhatMainnet", 43114], ["mainnet", 43113], ["default", 31337]] as const) {
      assert.throws(() => assertDeploymentTarget(networkName, chainId, { ...roles, FUJI_DEPLOYMENT_APPROVED: "43113" }), /Deployment target rejected/);
    }
  });

  it("requires a separate exact Fuji approval and complete public role configuration", () => {
    assert.throws(() => assertDeploymentTarget("avalancheFuji", 43113, roles), /FUJI_DEPLOYMENT_APPROVED/);
    assert.throws(() => assertDeploymentTarget("avalancheFuji", 43113, { FUJI_DEPLOYMENT_APPROVED: "43113" }), /FUJI_DEPLOYER_ADDRESS/);
    assert.doesNotThrow(() => assertDeploymentTarget("avalancheFuji", 43113, { ...roles, ...execution, FUJI_DEPLOYMENT_APPROVED: "43113" }));
  });

  it("requires the first receipt and preserves the pair budget across separate invocations", () => {
    assert.throws(() => assertDeploymentTarget("avalancheFuji", 43113, { ...roles, ...execution, FUJI_DEPLOYMENT_APPROVED: "43113", FUJI_APPROVED_CONTRACT: "EvidenceRegistry" }), /FUJI_AGREEMENT_DEPLOYMENT_TX_HASH/);
    const observed = { latestNonce: 1, pendingNonce: 1, gasPrice: 160n, gasEstimate: 484447n, initcodeHash: execution.FUJI_APPROVED_INITCODE_HASH as `0x${string}`, previousFee: 1500000000000000n };
    assert.throws(() => getFujiTransactionLimits("EvidenceRegistry", observed, { ...execution, FUJI_APPROVED_CONTRACT: "EvidenceRegistry" }), /remaining/);
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

  it("enforces approved fee envelope, contract, initcode, gas and exact nonce", () => {
    const observed = { latestNonce: 0, pendingNonce: 0, gasPrice: 160n, gasEstimate: 857732n, initcodeHash: execution.FUJI_APPROVED_INITCODE_HASH as `0x${string}` };
    assert.deepEqual(getFujiTransactionLimits("AgreementRegistry", observed, execution), { gas: 1200000n, gasPrice: 1000000000n, nonce: 0, value: 0n });
    assert.throws(() => getFujiExecutionPolicy({ ...execution, FUJI_GAS_PRICE_WEI: "1000000001" }), /envelope/);
    assert.throws(() => getFujiExecutionPolicy({ ...execution, FUJI_MAX_DEPLOYMENT_FEE_WEI: "2000000000000001" }), /envelope/);
    assert.throws(() => getFujiExecutionPolicy({ ...execution, FUJI_GAS_PRICE_WEI: "-1" }));
    assert.throws(() => getFujiTransactionLimits("AgreementRegistry", { ...observed, pendingNonce: 1 }, execution), /nonce/);
    assert.throws(() => getFujiTransactionLimits("AgreementRegistry", { ...observed, latestNonce: 1, pendingNonce: 1 }, execution), /nonce/);
    assert.throws(() => getFujiTransactionLimits("AgreementRegistry", { ...observed, gasPrice: 1000000001n }, execution), /price/);
    assert.throws(() => getFujiTransactionLimits("AgreementRegistry", { ...observed, gasEstimate: 1000001n }, execution), /Gas estimate/);
    assert.throws(() => getFujiTransactionLimits("EvidenceRegistry", observed, execution), /contract/);
    assert.throws(() => getFujiTransactionLimits("AgreementRegistry", { ...observed, initcodeHash: `0x${"b".repeat(64)}` }, execution), /initcode/);
    assert.equal(getFujiTransactionLimits("EvidenceRegistry", { ...observed, gasEstimate: 484447n, latestNonce: 1, pendingNonce: 1, previousFee: 1000000000000000n }, { ...execution, FUJI_APPROVED_CONTRACT: "EvidenceRegistry" }).nonce, 1);
  });

  it("rejects invalid or mismatched stdin keys without echoing their value", async () => {
    const connection = await network.create();
    const client = await connection.viem.getPublicClient();
    for (const secret of ["not-a-key", "a".repeat(129), "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"]) {
      await assert.rejects(readPrivateDeployerWallet(Readable.from([secret]), "0x0000000000000000000000000000000000000001", client.chain, custom(client)), (error: Error) => error.message === "Private deployer input rejected.");
    }
  });

  it("sends explicit nonce and fixed fee fields on an isolated local EVM", async () => {
    const connection = await network.create();
    const client = await connection.viem.getPublicClient();
    const [fixture] = await connection.viem.getWalletClients();
    const wallet = await readPrivateDeployerWallet(Readable.from(["ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"]), fixture.account.address, client.chain, custom(client));
    const start = await client.getTransactionCount({ address: wallet.account.address });
    let feePaid = 0n;
    for (const [offset, contract] of (["AgreementRegistry", "EvidenceRegistry"] as const).entries()) {
      const artifact = await artifacts.readArtifact(contract);
      const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode as Hex, args: contract === "EvidenceRegistry" ? [wallet.account.address] : [] });
      const nonce = start + offset;
      const gasEstimate = await client.estimateGas({ account: wallet.account.address, data });
      const policy = { ...execution, FUJI_DEPLOYER_START_NONCE: String(start), FUJI_APPROVED_CONTRACT: contract, FUJI_APPROVED_INITCODE_HASH: keccak256(data) };
      const limits = getFujiTransactionLimits(contract, { latestNonce: nonce, pendingNonce: nonce, gasEstimate, gasPrice: 1000000000n, initcodeHash: keccak256(data), previousFee: feePaid }, policy);
      const hash = await wallet.sendTransaction({ data, ...limits });
      const receipt = await client.waitForTransactionReceipt({ hash });
      const tx = await client.getTransaction({ hash });
      assert.equal(receipt.status, "success");
      assert.equal(tx.nonce, nonce);
      assert.equal(tx.gas, limits.gas);
      assert.equal(tx.gasPrice, limits.gasPrice);
      assert.equal(tx.type, "legacy");
      feePaid += receipt.gasUsed * receipt.effectiveGasPrice;
    }
    assert.ok(feePaid <= 2000000000000000n);
  });
});
