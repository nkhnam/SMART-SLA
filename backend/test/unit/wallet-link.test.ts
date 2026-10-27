import assert from "node:assert/strict";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const challenge = {
  organizationId: "0b847a83-7b9f-4c99-8803-7e7607a1e228",
  userId: "3ebf6e45-1c81-4e68-9510-13c6cfb6c9a7",
  nonce: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  deadline: 1800000000
};

test("wallet link signature verifies only against its EIP-712 domain and organization challenge", async () => {
  const protocol = await import("../../src/blockchain/wallet-link.js").catch(() => undefined);
  assert.ok(protocol, "wallet-link protocol must be available");
  const typedData = protocol.walletLinkChallengeTypedData(challenge, 31337, "0x0000000000000000000000000000000000000003");
  const signature = await account.signTypedData(typedData);

  assert.equal(await protocol.recoverWalletLinkSigner(typedData, signature), account.address);
  const replayed = {
    ...typedData,
    domain: { ...typedData.domain, chainId: 43113 }
  };
  assert.notEqual(await protocol.recoverWalletLinkSigner(replayed, signature), account.address);
});

test("wallet link payload rejects an invalid nonce and expired deadline", async () => {
  const protocol = await import("../../src/blockchain/wallet-link.js").catch(() => undefined);
  assert.ok(protocol, "wallet-link protocol must be available");

  assert.throws(
    () => protocol.walletLinkChallengeTypedData({ ...challenge, nonce: "bad" }, 31337, "0x0000000000000000000000000000000000000003"),
    /nonce must be 32-byte hex/
  );
  assert.throws(
    () => protocol.walletLinkChallengeTypedData({ ...challenge, deadline: 0 }, 31337, "0x0000000000000000000000000000000000000003"),
    /deadline must be a positive safe integer/
  );
});
