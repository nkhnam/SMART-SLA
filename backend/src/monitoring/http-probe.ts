import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { performance } from "node:perf_hooks";
import type { LookupFunction } from "node:net";
import { resolvePublicAddress, validateEndpointUrl, validateRedirectUrl } from "./ssrf.js";

const requestTimeoutMs = 5_000;
const responseLimitBytes = 65_536;
const redirectLimit = 3;

export const MONITORING_HTTP_PROBE = Symbol("MONITORING_HTTP_PROBE");

export type HttpProbeResult = {
  observedAt: Date;
  httpStatus: number | null;
  latencyMs: number | null;
  reachable: boolean;
  errorCategory: "TIMEOUT" | "DNS" | "CONNECTION" | "TLS" | "HTTP" | "RESPONSE_TOO_LARGE" | "INVALID_RESPONSE" | null;
  probeDurationMs: number;
};

type HttpReply = { statusCode: number; location: string | null; responseTooLarge: boolean; durationMs: number };

export async function probeHttpEndpoint(endpointUrl: string): Promise<HttpProbeResult> {
  const started = performance.now();
  const observedAt = new Date();
  try {
    let url = validateEndpointUrl(endpointUrl);
    for (let redirects = 0; redirects <= redirectLimit; redirects += 1) {
      const resolved = await resolvePublicAddress(url);
      const reply = await requestPinned(url, resolved.address, resolved.family);
      if (reply.responseTooLarge) {
        return { observedAt, httpStatus: reply.statusCode, latencyMs: reply.durationMs, reachable: false, errorCategory: "RESPONSE_TOO_LARGE", probeDurationMs: elapsed(started) };
      }
      if (reply.location && reply.statusCode >= 300 && reply.statusCode < 400) {
        if (redirects === redirectLimit) throw new ProbeError("INVALID_RESPONSE");
        url = validateRedirectUrl(url, reply.location);
        continue;
      }
      return {
        observedAt,
        httpStatus: reply.statusCode,
        latencyMs: reply.durationMs,
        reachable: reply.statusCode >= 200 && reply.statusCode < 400,
        errorCategory: reply.statusCode >= 200 && reply.statusCode < 400 ? null : "HTTP",
        probeDurationMs: elapsed(started)
      };
    }
    throw new ProbeError("INVALID_RESPONSE");
  } catch (error) {
    const errorCategory = classifyProbeError(error);
    return { observedAt, httpStatus: null, latencyMs: null, reachable: false, errorCategory, probeDurationMs: elapsed(started) };
  }
}

function requestPinned(url: URL, address: string, family: 4 | 6): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const lookup: LookupFunction = (_hostname, _options, callback) => callback(null, address, family);
    const request = requestFn(url, {
      method: "GET",
      headers: { accept: "*/*", "user-agent": "SLA-DEX-Monitor/1" },
      lookup,
      timeout: requestTimeoutMs,
      maxHeaderSize: 16_384
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location ?? null;
      if (location && statusCode >= 300 && statusCode < 400) {
        response.destroy();
        resolve({ statusCode, location, responseTooLarge: false, durationMs: elapsed(started) });
        return;
      }
      let responseBytes = 0;
      response.on("data", (chunk: Buffer) => {
        responseBytes += chunk.length;
        if (responseBytes > responseLimitBytes) {
          response.destroy(new ProbeError("RESPONSE_TOO_LARGE"));
        }
      });
      response.once("end", () => resolve({ statusCode, location: null, responseTooLarge: false, durationMs: elapsed(started) }));
      response.once("error", (error) => {
        if (error instanceof ProbeError && error.category === "RESPONSE_TOO_LARGE") {
          resolve({ statusCode, location: null, responseTooLarge: true, durationMs: elapsed(started) });
        } else {
          reject(error);
        }
      });
    });
    request.once("timeout", () => request.destroy(new ProbeError("TIMEOUT")));
    request.once("error", reject);
    request.end();
  });
}

class ProbeError extends Error {
  constructor(readonly category: HttpProbeResult["errorCategory"]) {
    super(category ?? "probe_failed");
  }
}

function classifyProbeError(error: unknown): NonNullable<HttpProbeResult["errorCategory"]> {
  if (error instanceof ProbeError && error.category) return error.category;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && code.startsWith("ERR_TLS")) return "TLS";
  if (typeof code === "string" && ["ENOTFOUND", "EAI_AGAIN", "ENODATA"].includes(code)) return "DNS";
  if (typeof code === "string" && ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(code)) return "TIMEOUT";
  if (error instanceof TypeError && /DNS|network address|hostname|routable/i.test(error.message)) return "DNS";
  if (error instanceof TypeError && /redirect|URL|port|scheme|credentials/i.test(error.message)) return "INVALID_RESPONSE";
  return "CONNECTION";
}

function elapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}
