import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthorizedSignersService } from "../../src/blockchain/authorized-signers.service.js";

function matches(record: Record<string, unknown>, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (key === "OR") return (expected as Array<Record<string, unknown>>).some((alternative) => matches(record, alternative));
    const actual = record[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("in" in expected) return (expected.in as unknown[]).includes(actual);
      return !!actual && typeof actual === "object" && matches(actual as Record<string, unknown>, expected as Record<string, unknown>);
    }
    return actual === expected;
  });
}

for (const [party, signerId, status, blocked] of [
  ["owner", "buyer-signer", "AWAITING_SIGNATURES", true],
  ["counterparty", "supplier-signer", "AWAITING_SIGNATURES", true],
  ["counterparty", "supplier-signer", "ANCHOR_PENDING", true],
  ["counterparty", "supplier-signer", "ANCHOR_CONFIRMED", false],
  ["unrelated", "another-signer", "AWAITING_SIGNATURES", false]
] as const) {
  test(party + " signer revocation respects its frozen snapshot in " + status, async () => {
    let revoked = false;
    const snapshot = { agreement: { ownerOrganizationId: "owner", status }, invalidatedAt: null,
      buyerAuthorizedSignerId: "buyer-signer", supplierAuthorizedSignerId: "supplier-signer", buyerSigner: "0xbuyer", supplierSigner: "0xsupplier" };
    const prisma = {
      authorizedSigner: { findFirst: async () => ({ id: signerId, address: "0xsupplier" }), update: async () => { revoked = true; return {}; } },
      signingSnapshot: { findFirst: async ({ where }: { where: Record<string, unknown> }) => matches(snapshot, where) ? { id: "snapshot" } : null },
      auditEvent: { create: async () => ({}) },
      $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(prisma)
    };
    const context = { user: { id: "user" }, organization: { id: party, role: "OWNER" } };
    const service = new AuthorizedSignersService(prisma as never, {} as never);
    if (blocked) await assert.rejects(service.revoke(context as never, signerId), /active signing snapshot/);
    else assert.deepEqual(await service.revoke(context as never, signerId), { id: signerId, revoked: true });
    assert.equal(revoked, !blocked);
  });
}
