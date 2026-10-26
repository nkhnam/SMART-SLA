import assert from "node:assert/strict";
import { test } from "node:test";

test("amendment is allowed only after workflow starts and before a transaction is pending", async () => {
  const lifecycle = await import("../../src/agreements/agreement-lifecycle.js").catch(() => undefined);
  assert.ok(lifecycle, "agreement lifecycle rules must be available");

  assert.equal(lifecycle.canAmendAgreement("AWAITING_COUNTERPARTY"), true);
  assert.equal(lifecycle.canAmendAgreement("AWAITING_SIGNATURES"), true);
  assert.equal(lifecycle.canAmendAgreement("ANCHOR_FAILED"), true);
  assert.equal(lifecycle.canAmendAgreement("ANCHOR_CONFIRMED"), true);
  assert.equal(lifecycle.canAmendAgreement("DRAFT"), false);
  assert.equal(lifecycle.canAmendAgreement("ANCHOR_PENDING"), false);
  assert.equal(lifecycle.canAmendAgreement("CANCELLED"), false);
});

test("cancellation cannot rewrite a confirmed or pending on-chain outcome", async () => {
  const lifecycle = await import("../../src/agreements/agreement-lifecycle.js").catch(() => undefined);
  assert.ok(lifecycle, "agreement lifecycle rules must be available");

  assert.equal(lifecycle.canCancelAgreement("DRAFT"), true);
  assert.equal(lifecycle.canCancelAgreement("AWAITING_COUNTERPARTY"), true);
  assert.equal(lifecycle.canCancelAgreement("AWAITING_SIGNATURES"), true);
  assert.equal(lifecycle.canCancelAgreement("ANCHOR_FAILED"), true);
  assert.equal(lifecycle.canCancelAgreement("ANCHOR_PENDING"), false);
  assert.equal(lifecycle.canCancelAgreement("ANCHOR_CONFIRMED"), false);
  assert.equal(lifecycle.canCancelAgreement("CANCELLED"), false);
});
