import assert from "node:assert/strict";
import { test } from "node:test";

const securityPromise = import("../../src/monitoring/webhook-security.js").catch(() => undefined);

test("authenticates the raw webhook body and signed metadata", async () => {
  const security = await securityPromise;
  assert.ok(security, "webhook security functions must be available");

  const rawBody = Buffer.from('{"observedAt":"2026-01-01T00:00:00Z","reachable":true}');
  const headers = { timestamp: "1767225600", nonce: "event-nonce-0001", eventId: "event-0001" };
  const signature = security.createWebhookSignature("a".repeat(64), headers, rawBody);
  const valid = security.verifyWebhookSignature("a".repeat(64), headers, rawBody, signature, 1767225600, 300);
  const tampered = security.verifyWebhookSignature("a".repeat(64), headers, Buffer.from(`${rawBody.toString()} `), signature, 1767225600, 300);

  assert.equal(valid, true);
  assert.equal(tampered, false);
});

test("rejects stale webhook timestamps", async () => {
  const security = await securityPromise;
  assert.ok(security, "webhook security functions must be available");

  const headers = { timestamp: "1767225000", nonce: "event-nonce-0002", eventId: "event-0002" };
  const signature = security.createWebhookSignature("b".repeat(64), headers, Buffer.from("{}"));

  assert.equal(security.verifyWebhookSignature("b".repeat(64), headers, Buffer.from("{}"), signature, 1767225600, 300), false);
});

test("encrypts webhook secrets for database storage and rejects a wrong key", async () => {
  const security = await securityPromise;
  assert.ok(security, "webhook security functions must be available");

  const key = Buffer.alloc(32, 7);
  const sealed = security.encryptWebhookSecret("provider-secret-value", key);
  assert.equal(security.decryptWebhookSecret(sealed, key), "provider-secret-value");
  assert.throws(() => security.decryptWebhookSecret(sealed, Buffer.alloc(32, 8)));
});
