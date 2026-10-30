import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const backend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contracts = resolve(backend, "../contracts");
const frontend = resolve(backend, "../frontend");
const workerReliability = process.argv.includes("--worker-reliability");
const publisherReliability = process.argv.includes("--publisher-reliability");
const browserMonitoring = process.argv.includes("--browser-monitoring");
assert.ok([workerReliability, publisherReliability, browserMonitoring].filter(Boolean).length <= 1, "Choose one reliability mode per invocation");
const outputArgument = process.argv.indexOf("--output");
assert.ok(outputArgument > 0 && process.argv[outputArgument + 1], "Usage: npm run test:phase2c-acceptance -- --output <absolute-artifact-directory>");
const outputRoot = process.argv[outputArgument + 1];
assert.ok(isAbsolute(outputRoot), "The artifact directory must be an absolute path");
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, "phase2c-"));
const runtimeHome = await mkdtemp(join(output, ".runtime-"));
const testEnvironment = {
  ...process.env, NODE_ENV: "test", HOME: runtimeHome, USERPROFILE: runtimeHome,
  APPDATA: join(runtimeHome, "appdata"), LOCALAPPDATA: join(runtimeHome, "localappdata"),
  XDG_CONFIG_HOME: join(runtimeHome, "config"), XDG_CACHE_HOME: join(runtimeHome, "cache"),
  TMPDIR: runtimeHome, TMP: runtimeHome, TEMP: runtimeHome, npm_config_cache: join(runtimeHome, "npm-cache")
};
const hardhatCli = join(contracts, "node_modules/hardhat/dist/src/cli.js");
const agreementKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const evidenceKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const activeChildren = new Set();
let containerName;

function child(command, args, options = {}) {
  const process = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
  activeChildren.add(process);
  process.once("close", () => activeChildren.delete(process));
  process.once("error", () => activeChildren.delete(process));
  return process;
}

async function command(command, args, options = {}) {
  const process = child(command, args, options);
  let stdout = "";
  let stderr = "";
  process.stdout.on("data", (data) => { stdout += data; });
  process.stderr.on("data", (data) => { stderr += data; });
  const [code] = await once(process, "close");
  return { code, stdout, stderr };
}

function safeLog(text) {
  return text.replace(/0x[0-9a-fA-F]{64}/g, "[redacted-hex]").replace(/postgresql:\/\/[^\s]+/g, "[redacted-database-url]");
}

async function runNode(args, cwd, env, logPath) {
  const result = await command(process.execPath, args, { cwd, env });
  await writeFile(logPath, safeLog(result.stdout + result.stderr));
  assert.equal(result.code, 0, `Command failed; see ${logPath}`);
  return result.stdout;
}

async function ready(label, probe, process) {
  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    if (process && (!process.pid || process.exitCode !== null || process.signalCode !== null)) throw new Error(`${label} exited before readiness`);
    try { if (await probe()) return; } catch { /* Readiness is checked again until the deadline. */ }
    await delay(100);
  }
  throw new Error(`${label} did not become ready within 60 seconds`);
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stop(process) {
  if (!process.pid || process.exitCode !== null || process.signalCode !== null) return;
  const exited = once(process, "close");
  process.kill();
  await exited;
}

async function deploy(client, wallet, name, args = []) {
  const artifact = JSON.parse(await readFile(join(contracts, `artifacts/contracts/${name}.sol/${name}.json`), "utf8"));
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  assert.ok(receipt.contractAddress);
  return receipt.contractAddress;
}

async function runScenario(databaseUrl, index) {
  const directory = join(output, `run-${index}`);
  await mkdir(directory);
  const databaseName = `phase2c_${randomUUID().replaceAll("-", "")}_test`;
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5_000 });
  let databaseCreated = false;
  let evm;
  let evmOutput = "";
  let api;
  let apiOutput = "";
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    if (workerReliability) {
      const environment = { ...testEnvironment, DATABASE_URL: isolatedUrl.toString(), CORS_ORIGINS: "http://localhost:3000" };
      await runNode([join(backend, "node_modules/prisma/build/index.js"), "migrate", "deploy"], backend, environment, join(directory, "migrations.log"));
      await runNode(["--test", "test/integration/monitoring-worker.integration.test.ts"], backend, environment, join(directory, "test.log"));
      console.log(`Monitoring reliability run ${index} passed; diagnostics: ${directory}`);
      return;
    }
    const port = await availablePort();
    const rpcUrl = `http://127.0.0.1:${port}`;
    const environment = { ...testEnvironment, DATABASE_URL: isolatedUrl.toString(), CORS_ORIGINS: "http://localhost:3000", MONITORING_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("hex") };
    evm = child(process.execPath, [hardhatCli, "node", "--network", "hardhatMainnet", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: contracts, env: environment });
    const capture = (data) => { evmOutput += String(data); };
    evm.stdout.on("data", capture);
    evm.stderr.on("data", capture);
    const chain = defineChain({ id: 31337, name: "Phase 2C isolated acceptance", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
    const client = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 0, timeout: 1_000 }) });
    await ready("Local EVM", async () => evmOutput.includes(`Started HTTP and WebSocket JSON-RPC server at ${rpcUrl}/`) && await client.getChainId() === 31337, evm);
    const wallet = createWalletClient({ chain, account: privateKeyToAccount(agreementKey), transport: http(rpcUrl) });
    const agreementRegistry = await deploy(client, wallet, "AgreementRegistry");
    const evidenceRegistry = await deploy(client, wallet, "EvidenceRegistry", [privateKeyToAccount(evidenceKey).address]);
    Object.assign(environment, {
      BLOCKCHAIN_RPC_URL: rpcUrl, BLOCKCHAIN_CHAIN_ID: "31337", BLOCKCHAIN_REGISTRY_ADDRESS: agreementRegistry,
      BLOCKCHAIN_RELAYER_PRIVATE_KEY: agreementKey, BLOCKCHAIN_CONFIRMATIONS: "1",
      EVIDENCE_RPC_URL: rpcUrl, EVIDENCE_CHAIN_ID: "31337", EVIDENCE_REGISTRY_ADDRESS: evidenceRegistry,
      EVIDENCE_RELAYER_PRIVATE_KEY: evidenceKey, EVIDENCE_CONFIRMATIONS: "1", PHASE2C_ACCEPTANCE_OUTPUT: directory
    });
    await runNode([join(backend, "node_modules/prisma/build/index.js"), "migrate", "deploy"], backend, environment, join(directory, "migrations.log"));
    if (browserMonitoring) {
      const apiPort = await availablePort();
      const frontendPort = await availablePort();
      const origin = `http://127.0.0.1:${frontendPort}`;
      const apiBase = `http://127.0.0.1:${apiPort}/api/v1`;
      Object.assign(environment, { PORT: String(apiPort), CORS_ORIGINS: origin, NEXT_PUBLIC_API_BASE_URL: apiBase, PLAYWRIGHT_BASE_URL: origin });
      const frontendEnvironment = { ...environment, NODE_ENV: "production" };
      api = child(process.execPath, [join(backend, "dist/main.js")], { cwd: backend, env: environment });
      api.stdout.on("data", (data) => { apiOutput += String(data); });
      api.stderr.on("data", (data) => { apiOutput += String(data); });
      await ready("Browser test API", async () => (await fetch(`${apiBase}/auth/me`, { signal: AbortSignal.timeout(1_000) })).status === 401, api);
      await runNode([process.env.npm_execpath, "run", "build"], frontend, frontendEnvironment, join(directory, "frontend-build.log"));
      await runNode([join(frontend, "node_modules/@playwright/test/cli.js"), "test", "--config=playwright.config.ts", "tests/e2e/phase2c.spec.ts", "--grep", "Gate 3C", "--workers=1", "--retries=0", "--reporter=line", "--output", join(directory, "browser-results")], frontend, frontendEnvironment, join(directory, "browser.log"));
      console.log(`Authenticated monitoring browser flows passed; diagnostics: ${directory}`);
      return;
    }
    if (publisherReliability) {
      await runNode(["--test", "test/integration/evidence-publisher.integration.test.ts"], backend, environment, join(directory, "test.log"));
      console.log(`Evidence publisher reliability run ${index} passed; diagnostics: ${directory}`);
      return;
    }
    await runNode(["--test", "test/integration/phase2c-acceptance.test.ts"], backend, environment, join(directory, "test.log"));
    const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8"));
    console.log(JSON.stringify({ run: index, ...summary }));
  } finally {
    if (api) await stop(api);
    if (browserMonitoring) await writeFile(join(directory, "api.log"), safeLog(apiOutput));
    if (evm) await stop(evm);
    await writeFile(join(directory, "evm.log"), safeLog(evmOutput));
    if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
}

try {
  const environment = testEnvironment;
  if (!workerReliability) await runNode([hardhatCli, "compile"], contracts, environment, join(output, "contracts-build.log"));
  let databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl) {
    const parsed = new URL(databaseUrl);
    assert.equal(parsed.protocol, "postgresql:");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname), "Acceptance PostgreSQL must be local");
    assert.match(parsed.pathname, /_test$/, "TEST_DATABASE_URL must identify an isolated _test database");
  } else {
    containerName = `sladex-phase2c-${randomUUID()}`;
    const started = await command("docker", ["run", "--detach", "--rm", "--name", containerName, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_DB=sladex_test", "--env", "POSTGRES_USER=sladex_test", "--env", "POSTGRES_PASSWORD=local-test-only", "postgres:17-alpine"]);
    await writeFile(join(output, "postgres-start.log"), safeLog(started.stdout + started.stderr));
    assert.equal(started.code, 0, "Cannot start test PostgreSQL; start Docker or provide a local TEST_DATABASE_URL with CREATEDB permission");
    const mapped = await command("docker", ["port", containerName, "5432/tcp"]);
    assert.equal(mapped.code, 0);
    const port = Number(mapped.stdout.trim().split(":").at(-1));
    assert.ok(port > 0);
    databaseUrl = `postgresql://sladex_test:local-test-only@127.0.0.1:${port}/sladex_test`;
  }
  await ready("Test PostgreSQL", async () => {
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1_000 });
    try { await client.connect(); await client.query("SELECT 1"); return true; } finally { await client.end(); }
  });
  await runNode([process.env.npm_execpath, "run", "build"], backend, { ...environment, DATABASE_URL: databaseUrl }, join(output, "backend-build.log"));
  for (const index of browserMonitoring ? [1] : [1, 2]) await runScenario(databaseUrl, index);
  console.log(`${browserMonitoring ? "Monitoring browser acceptance: 1 fresh run" : `${workerReliability ? "Monitoring reliability" : publisherReliability ? "Evidence publisher reliability" : "Phase 2C acceptance"}: 2 fresh runs`} passed. ${browserMonitoring ? "Disposable test artifacts" : "Safe artifacts"}: ${output}`);
} catch (error) {
  console.error(`Phase 2C acceptance failed (${error.name}): ${safeLog(error.message)}. Safe diagnostics: ${output}`);
  process.exitCode = 1;
} finally {
  for (const process of activeChildren) await stop(process);
  if (containerName) {
    const logs = await command("docker", ["logs", "--tail", "100", containerName]);
    await writeFile(join(output, "postgres.log"), safeLog(logs.stdout + logs.stderr));
    const stopped = await command("docker", ["rm", "--force", containerName]);
    if (stopped.code !== 0 && !stopped.stderr.includes("No such container")) {
      console.error(`Could not remove the owned PostgreSQL container ${containerName}`);
      process.exitCode = 1;
    }
  }
  await rm(runtimeHome, { recursive: true, force: true });
}
