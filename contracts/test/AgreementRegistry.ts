import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { zeroHash, type Address } from "viem";

const approvalTypes = {
  AgreementApproval: [
    { name: "agreementKey", type: "bytes32" },
    { name: "agreementHash", type: "bytes32" },
    { name: "version", type: "uint64" },
    { name: "buyerOrganization", type: "bytes32" },
    { name: "supplierOrganization", type: "bytes32" },
    { name: "buyerSigner", type: "address" },
    { name: "supplierSigner", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" }
  ] as const
};

describe("AgreementRegistry", async () => {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [buyer, supplier, unrelated] = await viem.getWalletClients();
  const registry = await viem.deployContract("AgreementRegistry");
  const chainId = await publicClient.getChainId();

  function approvalFor(agreementKey: `0x${string}`, deadline: bigint) {
    return {
      agreementKey,
      agreementHash: `0x${"ab".repeat(32)}` as `0x${string}`,
      version: 1n,
      buyerOrganization: `0x${"01".repeat(32)}` as `0x${string}`,
      supplierOrganization: `0x${"02".repeat(32)}` as `0x${string}`,
      buyerSigner: buyer.account.address,
      supplierSigner: supplier.account.address,
      nonce: 1n,
      deadline
    };
  }

  async function sign(approval: ReturnType<typeof approvalFor>, signer: typeof buyer, verifyingContract: Address = registry.address, signedChain = chainId) {
    return signer.signTypedData({
      account: signer.account,
      domain: { name: "SLA-DEX Agreement Registry", version: "1", chainId: signedChain, verifyingContract },
      types: approvalTypes,
      primaryType: "AgreementApproval",
      message: approval
    });
  }

  it("registers only after both expected parties sign and stores a privacy-minimal record", async () => {
    const agreementKey = `0x${"11".repeat(32)}` as `0x${string}`;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const approval = approvalFor(agreementKey, deadline);
    const buyerSignature = await sign(approval, buyer);
    const supplierSignature = await sign(approval, supplier);
    const hash = await registry.write.registerAgreement([approval, buyerSignature, supplierSignature]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    const registered = await registry.read.getAgreement([agreementKey]);
    assert.equal(registered.agreementHash, approval.agreementHash);
    assert.equal(registered.version, approval.version);
    assert.equal(registered.buyerOrganization, approval.buyerOrganization);
    assert.equal(registered.supplierOrganization, approval.supplierOrganization);
    assert.equal(registered.validUntil, deadline);
    assert.equal((await publicClient.getContractEvents({ address: registry.address, abi: registry.abi, eventName: "AgreementRegistered", fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber })).length, 1);
  });

  it("rejects a forged party signature, expired approval, wrong verifying contract and replay", async () => {
    const agreementKey = `0x${"12".repeat(32)}` as `0x${string}`;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const approval = approvalFor(agreementKey, deadline);
    await assert.rejects(registry.write.registerAgreement([
      approval,
      await sign(approval, buyer),
      await sign(approval, unrelated)
    ]));
    await assert.rejects(registry.write.registerAgreement([
      approval,
      await sign(approval, buyer, `0x${"33".repeat(20)}`),
      await sign(approval, supplier, `0x${"33".repeat(20)}`)
    ]));
    await assert.rejects(registry.write.registerAgreement([
      approvalFor(agreementKey, 1n),
      await sign(approvalFor(agreementKey, 1n), buyer),
      await sign(approvalFor(agreementKey, 1n), supplier)
    ]));
    const signatures = [await sign(approval, buyer), await sign(approval, supplier)] as const;
    await registry.write.registerAgreement([approval, ...signatures]);
    await assert.rejects(registry.write.registerAgreement([approval, ...signatures]));
  });

  it("binds approvals to the chain ID and rejects empty agreement hashes", async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const approval = approvalFor(`0x${"13".repeat(32)}`, deadline);
    await assert.rejects(registry.write.registerAgreement([
      approval,
      await sign(approval, buyer, registry.address, chainId + 1),
      await sign(approval, supplier, registry.address, chainId + 1)
    ]));
    const emptyHash = { ...approval, agreementHash: zeroHash };
    await assert.rejects(registry.write.registerAgreement([
      emptyHash,
      await sign(emptyHash, buyer),
      await sign(emptyHash, supplier)
    ]));
  });
});
