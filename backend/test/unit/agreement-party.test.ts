import assert from "node:assert/strict";
import { test } from "node:test";

test("agreement party roles map CUSTOMER and PROVIDER in either invitation direction", async () => {
  const parties = await import("../../src/agreements/agreement-party.js").catch(() => undefined);
  assert.ok(parties, "agreement party roles must be available");

  assert.deepEqual(parties.resolveAgreementPartyRoles("CUSTOMER", "PROVIDER"), {
    owner: "BUYER",
    counterparty: "SUPPLIER"
  });
  assert.deepEqual(parties.resolveAgreementPartyRoles("PROVIDER", "CUSTOMER"), {
    owner: "SUPPLIER",
    counterparty: "BUYER"
  });
});

test("agreement party roles reject OTHER or same-type organizations", async () => {
  const parties = await import("../../src/agreements/agreement-party.js").catch(() => undefined);
  assert.ok(parties, "agreement party roles must be available");

  assert.throws(() => parties.resolveAgreementPartyRoles("OTHER", "PROVIDER"), /one CUSTOMER and one PROVIDER/);
  assert.throws(() => parties.resolveAgreementPartyRoles("CUSTOMER", "CUSTOMER"), /one CUSTOMER and one PROVIDER/);
});
