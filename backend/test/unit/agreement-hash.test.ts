import assert from "node:assert/strict";
import { test } from "node:test";

test("canonical snapshot hashing normalizes text and exclusion ordering", async () => {
  const protocol = await import("../../src/blockchain/agreement-hash.service.js").catch(() => undefined);
  assert.ok(protocol, "agreement hash service must be available");

  const input = {
    agreementId: "3ebf6e45-1c81-4e68-9510-13c6cfb6c9a7",
    reference: "SLA-2026-001",
    version: 1,
    buyerOrganizationId: "0b847a83-7b9f-4c99-8803-7e7607a1e228",
    supplierOrganizationId: "b0f2af02-399f-4bd2-b8cb-1c818de6d4fc",
    name: "Café SLA",
    serviceDescription: "Managed platform",
    uptimeTargetBasisPoints: 9995,
    responseTimeTargetMs: 180,
    measurementWindowHours: 24,
    exclusions: ["maintenance", "force majeure"],
    notes: null,
    buyerSigner: "0x0000000000000000000000000000000000000001",
    supplierSigner: "0x0000000000000000000000000000000000000002",
    validUntil: 1799999999
  };
  const equivalent = {
    ...input,
    name: "Café SLA".normalize("NFD"),
    exclusions: ["force majeure", "maintenance"]
  };

  const first = protocol.canonicalizeAgreementSnapshot(input);
  const second = protocol.canonicalizeAgreementSnapshot(equivalent);
  assert.equal(first.canonicalJson, second.canonicalJson);
  assert.match(first.canonicalJson, /"name":"Café SLA"/);
  assert.equal(first.snapshot.uptimeTargetBasisPoints, 9995);
  assert.equal(first.hash, second.hash);
  assert.equal(first.hash, "0x6059588811b83299b5dca027af37339af5978167d4cab83ef8ee8b025351ccb8");
  const blankNotes = protocol.canonicalizeAgreementSnapshot({ ...input, notes: " \n " });
  assert.equal(blankNotes.snapshot.notes, null);
  assert.equal(blankNotes.hash, first.hash);
  assert.notEqual(protocol.agreementKey(input.agreementId, 1), protocol.agreementKey(input.agreementId, 2));
  const typedData = protocol.agreementApprovalTypedData(
    first,
    43113,
    "0x0000000000000000000000000000000000000003",
    7n,
    1799999999
  );
  assert.deepEqual(typedData.domain, {
    name: "SLA-DEX Agreement Registry",
    version: "1",
    chainId: 43113,
    verifyingContract: "0x0000000000000000000000000000000000000003"
  });
  assert.equal(typedData.primaryType, "AgreementApproval");
  assert.equal(typedData.message.agreementHash, first.hash);
  assert.equal(typedData.message.version, 1n);
  assert.equal(typedData.message.nonce, 7n);
  assert.equal(typedData.message.deadline, 1799999999n);
  assert.throws(
    () => protocol.agreementApprovalTypedData(first, 43113, "0x0000000000000000000000000000000000000003", 7n, 1800000001),
    /deadline must equal the frozen snapshot validity/
  );
});

test("canonical snapshot hash changes when a material term changes", async () => {
  const protocol = await import("../../src/blockchain/agreement-hash.service.js").catch(() => undefined);
  assert.ok(protocol, "agreement hash service must be available");
  const base = {
    agreementId: "3ebf6e45-1c81-4e68-9510-13c6cfb6c9a7",
    reference: "SLA-2026-001",
    version: 1,
    buyerOrganizationId: "0b847a83-7b9f-4c99-8803-7e7607a1e228",
    supplierOrganizationId: "b0f2af02-399f-4bd2-b8cb-1c818de6d4fc",
    name: "Cloud SLA",
    serviceDescription: "Managed platform",
    uptimeTargetBasisPoints: 9995,
    responseTimeTargetMs: 180,
    measurementWindowHours: 24,
    exclusions: ["maintenance"],
    notes: null,
    buyerSigner: "0x0000000000000000000000000000000000000001",
    supplierSigner: "0x0000000000000000000000000000000000000002",
    validUntil: 1799999999
  };
  const first = protocol.canonicalizeAgreementSnapshot(base);
  const mutations = [
    { ...base, agreementId: "aebf6e45-1c81-4e68-9510-13c6cfb6c9a7" },
    { ...base, reference: "SLA-2026-002" },
    { ...base, version: 2 },
    { ...base, buyerOrganizationId: "1b847a83-7b9f-4c99-8803-7e7607a1e228" },
    { ...base, supplierOrganizationId: "c0f2af02-399f-4bd2-b8cb-1c818de6d4fc" },
    { ...base, name: "Changed SLA" },
    { ...base, serviceDescription: "Changed platform" },
    { ...base, uptimeTargetBasisPoints: 9994 },
    { ...base, responseTimeTargetMs: 181 },
    { ...base, measurementWindowHours: 25 },
    { ...base, exclusions: ["maintenance", "network outage"] },
    { ...base, notes: "Additional term" },
    { ...base, buyerSigner: "0x0000000000000000000000000000000000000003" },
    { ...base, supplierSigner: "0x0000000000000000000000000000000000000004" },
    { ...base, validUntil: 1799999998 }
  ];
  for (const mutation of mutations) {
    assert.notEqual(protocol.canonicalizeAgreementSnapshot(mutation).hash, first.hash);
  }
});

test("persisted decimal uptime converts to integer basis points without rounding", async () => {
  const protocol = await import("../../src/blockchain/agreement-hash.service.js").catch(() => undefined);
  assert.ok(protocol, "agreement hash service must be available");

  assert.equal(protocol.basisPointsFromPercent("99.95"), 9995);
  assert.equal(protocol.basisPointsFromPercent("100.00"), 10000);
  assert.throws(() => protocol.basisPointsFromPercent("99.951"), /at most two decimal places/);
  assert.throws(() => protocol.basisPointsFromPercent("100.01"), /between 0 and 100 percent/);
});
