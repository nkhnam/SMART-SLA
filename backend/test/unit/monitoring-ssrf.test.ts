import assert from "node:assert/strict";
import { test } from "node:test";

const ssrfPromise = import("../../src/monitoring/ssrf.js").catch(() => undefined);

test("rejects loopback, private, link-local, reserved and metadata addresses", async () => {
  const ssrf = await ssrfPromise;
  assert.ok(ssrf, "SSRF validation functions must be available");

  for (const address of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.4", "169.254.10.1", "0.0.0.1", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:192.168.1.10"]) {
    assert.equal(ssrf.isPublicAddress(address), false, address);
  }
  assert.equal(ssrf.isPublicAddress("8.8.8.8"), true);
  assert.equal(ssrf.isPublicAddress("2606:4700:4700::1111"), true);
});

test("rejects unsupported URL schemes, credentials and nonstandard ports", async () => {
  const ssrf = await ssrfPromise;
  assert.ok(ssrf, "SSRF validation functions must be available");

  assert.throws(() => ssrf.validateEndpointUrl("file:///etc/passwd"));
  assert.throws(() => ssrf.validateEndpointUrl("http://user:password@example.com/"));
  assert.throws(() => ssrf.validateEndpointUrl("https://example.com:8443/"));
  assert.throws(() => ssrf.validateEndpointUrl("http://localhost/"));
  assert.equal(ssrf.validateEndpointUrl("https://example.com/health").hostname, "example.com");
});

test("rejects DNS answers that include a restricted address and revalidates redirects", async () => {
  const ssrf = await ssrfPromise;
  assert.ok(ssrf, "SSRF validation functions must be available");

  const endpoint = ssrf.validateEndpointUrl("https://example.com/health");
  await assert.rejects(() => ssrf.resolvePublicAddress(endpoint, async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "169.254.169.254", family: 4 }
  ]));
  assert.throws(() => ssrf.validateRedirectUrl(endpoint, "http://example.com/"));
  assert.throws(() => ssrf.validateRedirectUrl(endpoint, "http://127.0.0.1/"));
  assert.equal(ssrf.validateRedirectUrl(endpoint, "/status").href, "https://example.com/status");
});
