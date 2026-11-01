import assert from "node:assert/strict";
import dns from "node:dns/promises";
import https, { type RequestOptions } from "node:https";
import type { IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { probeHttpEndpoint } from "../../src/monitoring/http-probe.js";

test("pins the validated DNS answer while retaining the HTTPS hostname and revalidates redirect DNS", async (t) => {
  const hosts: string[] = [];
  let requests = 0;
  t.mock.method(dns, "lookup", async (hostname: string) => {
    hosts.push(hostname);
    return [{ address: hostname === "redirect.example.com" ? "127.0.0.1" : "93.184.215.14", family: 4 }];
  });
  t.mock.method(https, "request", (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    requests++;
    assert.equal(url.hostname, "public.example.com");
    assert.equal(options.timeout, 5000);
    assert.equal(options.maxHeaderSize, 16384);
    assert.equal(options.rejectUnauthorized, undefined);
    assert.equal(options.method, "GET");
    assert.ok(options.lookup);
    options.lookup(url.hostname, {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, "93.184.215.14");
      assert.equal(family, 4);
    });
    options.lookup(url.hostname, { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: "93.184.215.14", family: 4 }]);
    });
    const request = new EventEmitter();
    Object.assign(request, { end: () => queueMicrotask(() => {
      const response = new PassThrough();
      Object.assign(response, { statusCode: 302, headers: { location: "https://redirect.example.com/" } });
      callback(response as unknown as IncomingMessage);
    }) });
    return request;
  });
  syncBuiltinESMExports();
  try {
    const result = await probeHttpEndpoint("https://public.example.com/");
    assert.deepEqual(hosts, ["public.example.com", "redirect.example.com"]);
    assert.equal(requests, 1);
    assert.equal(result.reachable, false);
    assert.equal(result.errorCategory, "DNS");
    assert.equal(result.httpStatus, null);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("categorizes actual HTTP replies, oversized bodies, timeouts and TLS/DNS transport errors", async (t) => {
  let mode: "healthy" | "http" | "large" | "timeout" | "dns" | "tls" = "healthy";
  t.mock.method(dns, "lookup", async () => {
    if (mode === "dns") throw Object.assign(new Error("fixture DNS failure"), { code: "ENOTFOUND" });
    return [{ address: "93.184.215.14", family: 4 }];
  });
  t.mock.method(https, "request", (_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const request = new EventEmitter();
    Object.assign(request, {
      destroy: (error: Error) => request.emit("error", error),
      end: () => queueMicrotask(() => {
        if (mode === "timeout") { request.emit("timeout"); return; }
        if (mode === "tls") { request.emit("error", Object.assign(new Error("fixture TLS failure"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" })); return; }
        const response = new PassThrough();
        Object.assign(response, { statusCode: mode === "http" ? 503 : 200, headers: {} });
        callback(response as unknown as IncomingMessage);
        response.end(Buffer.alloc(mode === "large" ? 65537 : 16));
      })
    });
    return request;
  });
  syncBuiltinESMExports();
  try {
    for (const [scenario, reachable, httpStatus, category] of [
      ["healthy", true, 200, null], ["http", false, 503, "HTTP"], ["large", false, 200, "RESPONSE_TOO_LARGE"],
      ["timeout", false, null, "TIMEOUT"], ["dns", false, null, "DNS"], ["tls", false, null, "TLS"]
    ] as const) {
      mode = scenario;
      const result = await probeHttpEndpoint("https://public.example.com/");
      assert.equal(result.reachable, reachable, scenario);
      assert.equal(result.httpStatus, httpStatus, scenario);
      assert.equal(result.errorCategory, category, scenario);
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
