import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const frontendDirectory = fileURLToPath(new URL("..", import.meta.url));
const buildIdPath = join(frontendDirectory, ".next", "BUILD_ID");
const routes = [
  ["/", "Verifiable SLA infrastructure on Avalanche"],
  ["/overview", "Service health, at a glance"],
  ["/agreements", "All agreements"],
  ["/agreements/new", "Create an agreement"],
  ["/agreements/agr-1042", "Managed cloud operations"],
  ["/agreements/agr-1038", "Regional network service"],
  ["/agreements/agr-1021", "Order processing API"],
  ["/agreements/agr-1014", "Patient data exchange"],
  ["/monitoring", "Source comparison"],
  ["/disputes", "Dispute review"],
  ["/verification", "Evidence verification"],
  ["/settings", "Organization settings"],
];

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(child, origin) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production server exited with ${child.exitCode}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("Production server did not become ready within 30 seconds");
}

assert.ok(existsSync(buildIdPath), "Run npm run build before the production smoke check");
const port = await findAvailablePort();
const origin = `http://127.0.0.1:${port}`;
const nextCli = join(frontendDirectory, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: frontendDirectory,
  stdio: "ignore",
});
const failures = [];

try {
  await waitForServer(server, origin);
  for (const [route, expectedContent] of routes) {
    try {
      const response = await fetch(new URL(route, origin), { signal: AbortSignal.timeout(5000) });
      const html = await response.text();
      assert.equal(response.status, 200, `${route} should return HTTP 200`);
      assert.ok(html.includes(expectedContent), `${route} should contain its expected page content`);
      assert.ok(html.includes("DEMO DATA"), `${route} should label example data`);
      if (route !== "/") assert.ok(html.includes("Workspace navigation"), `${route} should expose workspace navigation`);
      const internalPaths = new Set([...html.matchAll(/href="(\/[^"?#]+)(?:[?#][^"]*)?"/g)].map(match => match[1]).filter(path => !path.startsWith("/_next/")));
      for (const path of internalPaths) {
        const linkResponse = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(5000) });
        assert.equal(linkResponse.status, 200, `${route} link ${path} should resolve`);
      }
      if (["/agreements/new", "/agreements/agr-1042", "/disputes", "/verification", "/settings"].includes(route)) {
        assert.match(html, /<button[^>]*disabled/, `${route} should expose a disabled preview action`);
      }
      console.log(`PASS ${route}`);
    } catch (error) {
      failures.push(`${route}: ${error.message}`);
      console.error(`FAIL ${route}: ${error.message}`);
    }
  }
} catch (error) {
  failures.push(error.message);
  console.error(`FAIL startup: ${error.message}`);
} finally {
  if (server.exitCode === null) {
    const closed = new Promise(resolve => server.once("close", resolve));
    server.kill();
    await Promise.race([closed, delay(5000)]);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} production smoke check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\n${routes.length} production route checks passed. Browser-only checks were not run.`);
}
