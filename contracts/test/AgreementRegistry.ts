import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { zeroAddress, zeroHash, type Address } from "viem";

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
  const [buyer, supplier, unrelated, attackerSupplier] = await viem.getWalletClients();
  const registry = await viem.deployContract("AgreementRegistry", [buyer.account.address]);
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

  it("prevents an unauthorized signer pair from poisoning a known agreement key", async () => {
    const agreementKey = `0x${"1b".repeat(32)}` as `0x${string}`;
    const legitimate = approvalFor(agreementKey, BigInt(Math.floor(Date.now() / 1000) + 600));
    const attackerApproval = { ...legitimate, agreementHash: `0x${"cd".repeat(32)}` as `0x${string}`,
      buyerSigner: unrelated.account.address, supplierSigner: attackerSupplier.account.address };
    await assert.rejects(registry.write.registerAgreement([
      attackerApproval, await sign(attackerApproval, unrelated), await sign(attackerApproval, attackerSupplier)
    ], { account: unrelated.account }), /UnauthorizedPublisher/);
    const hash = await registry.write.registerAgreement([
      legitimate, await sign(legitimate, buyer), await sign(legitimate, supplier)
    ]);
    assert.equal((await publicClient.waitForTransactionReceipt({ hash })).status, "success");
    assert.equal((await registry.read.getAgreement([agreementKey])).agreementHash, legitimate.agreementHash);
  });

  it("rejects a zero publisher at construction", async () => {
    await assert.rejects(viem.deployContract("AgreementRegistry", [zeroAddress]), /InvalidApproval/);
  });

  it("allows only the permanent owner to rotate the nonzero publisher without changing records", async () => {
    const isolated = await viem.deployContract("AgreementRegistry", [supplier.account.address]);
    assert.equal((await isolated.read.owner()).toLowerCase(), buyer.account.address.toLowerCase());
    assert.equal((await isolated.read.publisher()).toLowerCase(), supplier.account.address.toLowerCase());
    await assert.rejects(isolated.write.setPublisher([unrelated.account.address], { account: supplier.account }), /UnauthorizedOwner/);
    await assert.rejects(isolated.write.setPublisher([zeroAddress]), /InvalidApproval/);
    const first = approvalFor(`0x${"1c".repeat(32)}`, BigInt(Math.floor(Date.now() / 1000) + 600));
    const firstSignatures = [await sign(first, buyer, isolated.address), await sign(first, supplier, isolated.address)] as const;
    await assert.rejects(isolated.write.registerAgreement([first, ...firstSignatures]), /UnauthorizedPublisher/);
    await publicClient.waitForTransactionReceipt({ hash: await isolated.write.registerAgreement([first, ...firstSignatures], { account: supplier.account }) });
    const stored = await isolated.read.getAgreement([first.agreementKey]);
    await publicClient.waitForTransactionReceipt({ hash: await isolated.write.setPublisher([unrelated.account.address]) });
    assert.equal((await isolated.read.publisher()).toLowerCase(), unrelated.account.address.toLowerCase());
    const second = approvalFor(`0x${"1d".repeat(32)}`, BigInt(Math.floor(Date.now() / 1000) + 600));
    const secondSignatures = [await sign(second, buyer, isolated.address), await sign(second, supplier, isolated.address)] as const;
    await assert.rejects(isolated.write.registerAgreement([second, ...secondSignatures], { account: supplier.account }), /UnauthorizedPublisher/);
    await publicClient.waitForTransactionReceipt({ hash: await isolated.write.registerAgreement([second, ...secondSignatures], { account: unrelated.account }) });
    assert.deepEqual(await isolated.read.getAgreement([first.agreementKey]), stored);
    await assert.rejects(isolated.write.registerAgreement([first, ...firstSignatures], { account: unrelated.account }), /AgreementAlreadyRegistered/);
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

  it("rejects an invalid Buyer signature independently", async () => {
    const approval = approvalFor(`0x${"14".repeat(32)}`, BigInt(Math.floor(Date.now() / 1000) + 600));
    await assert.rejects(registry.write.registerAgreement([
      approval,
      await sign(approval, unrelated),
      await sign(approval, supplier)
    ]));
  });

  it("rejects an invalid Supplier signature independently", async () => {
    const approval = approvalFor(`0x${"1a".repeat(32)}`, BigInt(Math.floor(Date.now() / 1000) + 600));
    await assert.rejects(registry.write.registerAgreement([
      approval,
      await sign(approval, buyer),
      await sign(approval, unrelated)
    ]));
  });

  it("rejects a signature when the expected signer address changes", async () => {
    const approval = approvalFor(`0x${"15".repeat(32)}`, BigInt(Math.floor(Date.now() / 1000) + 600));
    const changedSigner = { ...approval, buyerSigner: unrelated.account.address };
    await assert.rejects(registry.write.registerAgreement([
      changedSigner,
      await sign(approval, buyer),
      await sign(approval, supplier)
    ]));
  });

  it("binds both signatures to the exact agreement hash and version", async () => {
    const approval = approvalFor(`0x${"16".repeat(32)}`, BigInt(Math.floor(Date.now() / 1000) + 600));
    const buyerSignature = await sign(approval, buyer);
    const supplierSignature = await sign(approval, supplier);
    await assert.rejects(registry.write.registerAgreement([
      { ...approval, agreementHash: `0x${"bc".repeat(32)}` }, buyerSignature, supplierSignature
    ]));
    await assert.rejects(registry.write.registerAgreement([
      { ...approval, version: 2n }, buyerSignature, supplierSignature
    ]));
  });

  it("rejects signatures replayed against a different agreement key", async () => {
    const approval = approvalFor(`0x${"17".repeat(32)}`, BigInt(Math.floor(Date.now() / 1000) + 600));
    const signatures = [await sign(approval, buyer), await sign(approval, supplier)] as const;
    await assert.rejects(registry.write.registerAgreement([
      { ...approval, agreementKey: `0x${"18".repeat(32)}` }, ...signatures
    ]));
  });

  it("does not enforce organization authorization for the addresses named by the signatures", async () => {
    const approval = {
      ...approvalFor(`0x${"19".repeat(32)}`, BigInt(Math.floor(Date.now() / 1000) + 600)),
      buyerSigner: unrelated.account.address
    };
    const hash = await registry.write.registerAgreement([
      approval,
      await sign(approval, unrelated),
      await sign(approval, supplier)
    ]);
    assert.equal((await publicClient.waitForTransactionReceipt({ hash })).status, "success");
    assert.equal((await registry.read.getAgreement([approval.agreementKey])).agreementHash, approval.agreementHash);
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
