import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureWalletChain, requestWalletAccounts, signWalletTypedData } from "../lib/wallet.ts";

test("wallet connection requests accounts and signing stays on the connected EIP-1193 provider", async () => {
  const calls = [];
  const provider = { request: async (request) => {
    calls.push(request);
    if (request.method === "eth_requestAccounts") return ["0x0000000000000000000000000000000000000001"];
    if (request.method === "eth_chainId") return "0xa869";
    if (request.method === "eth_signTypedData_v4") return `0x${"11".repeat(65)}`;
    throw new Error(`Unexpected method ${request.method}`);
  } };

  assert.deepEqual(await requestWalletAccounts(provider), ["0x0000000000000000000000000000000000000001"]);
  await ensureWalletChain(provider, 43113);
  const typedData = { domain: { chainId: 43113 }, primaryType: "AgreementApproval", message: { nonce: 1n } };
  assert.equal(await signWalletTypedData(provider, "0x0000000000000000000000000000000000000001", typedData), `0x${"11".repeat(65)}`);
  assert.equal(calls.at(-1).method, "eth_signTypedData_v4");
  assert.deepEqual(calls.at(-1).params, ["0x0000000000000000000000000000000000000001", JSON.stringify(typedData, (_, value) => typeof value === "bigint" ? value.toString() : value)]);
});

test("wallet flow switches networks and verifies the active chain", async () => {
  let chainId = "0x1";
  const provider = { request: async ({ method, params }) => {
    if (method === "eth_chainId") return chainId;
    if (method === "wallet_switchEthereumChain") {
      assert.deepEqual(params, [{ chainId: "0xa869" }]);
      chainId = "0xa869";
      return null;
    }
    throw new Error(`Unexpected method ${method}`);
  } };
  await ensureWalletChain(provider, 43113);
  assert.equal(chainId, "0xa869");
});
