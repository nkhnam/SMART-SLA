import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { validateEnvironment } from "../../src/config/env.schema.js";
import { MonitoringWorkerService } from "../../src/monitoring/monitoring-worker.service.js";
import { MonitoringRetentionService } from "../../src/monitoring/monitoring-retention.service.js";
import { AgreementAnchoringService } from "../../src/blockchain/agreement-anchoring.service.js";
import { EvidenceAnchorWorkerService } from "../../src/monitoring/evidence-anchor-worker.service.js";
import { localBackendEnvironment } from "../../scripts/local-backend-env.mjs";

test("local launcher excludes inherited credentials and runtime overrides", () => {
  const databaseUrl = "postgresql://app:fixture@127.0.0.1:5434/demo";
  const env = localBackendEnvironment(databaseUrl, { PATH: "fixture", DATABASE_URL: "wrong", NODE_OPTIONS: "--bad-preload", HOST: "0.0.0.0", WORKERS_ENABLED: "true", BLOCKCHAIN_RELAYER_PRIVATE_KEY: "fixture", EVIDENCE_RELAYER_PRIVATE_KEY: "fixture", MONITORING_SECRET_ENCRYPTION_KEY: "fixture" });
  assert.equal(env.HOST, "127.0.0.1");
  assert.equal(env.WORKERS_ENABLED, "false");
  assert.equal(env.LOCAL_SAFE_MODE, "true");
  assert.equal(env.DATABASE_URL, databaseUrl);
  for (const key of ["NODE_OPTIONS", "BLOCKCHAIN_RELAYER_PRIVATE_KEY", "EVIDENCE_RELAYER_PRIVATE_KEY", "MONITORING_SECRET_ENCRYPTION_KEY"]) assert.equal(env[key], undefined);
  assert.throws(() => localBackendEnvironment("postgresql://app:fixture@remote.example/demo"));
  assert.throws(() => localBackendEnvironment("postgresql://app@127.0.0.1/demo"));
});

test("local configuration explicitly disables workers and selects loopback", () => {
  const result = validateEnvironment({ NODE_ENV: "development", DATABASE_URL: "postgresql://app:fixture@localhost/demo", HOST: "127.0.0.1", WORKERS_ENABLED: "false" });
  assert.equal(result.HOST, "127.0.0.1");
  assert.equal(result.WORKERS_ENABLED, "false");
  assert.throws(() => validateEnvironment({ NODE_ENV: "development", DATABASE_URL: "postgresql://app:fixture@localhost/demo", WORKERS_ENABLED: "0" }));
  const safe = { NODE_ENV: "development", DATABASE_URL: "postgresql://app:fixture@localhost/demo", LOCAL_SAFE_MODE: "true", HOST: "127.0.0.1", WORKERS_ENABLED: "false" };
  assert.doesNotThrow(() => validateEnvironment(safe));
  assert.throws(() => validateEnvironment({ ...safe, HOST: "0.0.0.0" }), /Local safe mode requires/);
  assert.throws(() => validateEnvironment({ ...safe, WORKERS_ENABLED: "true" }), /Local safe mode requires/);
  assert.throws(() => validateEnvironment({ ...safe, EVIDENCE_RPC_URL: "https://example.com" }), /Local safe mode requires/);
});

test("disabled workers neither schedule timers nor access dependencies through public entries", async () => {
  const previous = process.env.WORKERS_ENABLED;
  process.env.WORKERS_ENABLED = "false";
  let accesses = 0;
  const dependency = new Proxy({}, { get() { accesses++; throw new Error("disabled worker accessed dependency"); } });
  const monitoring = new MonitoringWorkerService(dependency as never, dependency as never);
  const retention = new MonitoringRetentionService(dependency as never);
  const agreement = new AgreementAnchoringService(dependency as never, dependency as never);
  const evidence = new EvidenceAnchorWorkerService(dependency as never, dependency as never);
  const workers = [monitoring, retention, agreement, evidence];
  const timer = mock.method(globalThis, "setInterval", () => { throw new Error("disabled worker scheduled timer"); });
  try {
    for (const worker of workers) worker.onModuleInit();
    await monitoring.processDueSources();
    assert.equal(await retention.purgeExpired(), 0);
    await agreement.processPendingIntents();
    await evidence.processPending();
    assert.equal(accesses, 0);
    assert.equal(timer.mock.callCount(), 0);
  } finally {
    for (const worker of workers) worker.onModuleDestroy();
    timer.mock.restore();
    if (previous === undefined) delete process.env.WORKERS_ENABLED;
    else process.env.WORKERS_ENABLED = previous;
  }
});

test("development configuration defaults to the local frontend and port", () => {
  const result = validateEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://sladex:local-dev-only@localhost:5432/sladex_dev"
  });

  assert.equal(result.PORT, 4000);
  assert.deepEqual(result.CORS_ORIGINS, ["http://localhost:3000"]);
  assert.equal(result.SESSION_TTL_HOURS, 168);
});

test("production requires an explicit HTTPS origin allowlist", () => {
  assert.throws(() => validateEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:secret@db.example.com/sladex"
  }), /CORS_ORIGINS must be configured in production/);

  assert.throws(() => validateEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:secret@db.example.com/sladex",
    CORS_ORIGINS: "http://app.example.com"
  }), /Production CORS origins must use HTTPS/);
});

test("critical database configuration cannot be omitted", () => {
  assert.throws(() => validateEnvironment({ NODE_ENV: "development" }));
});

test("missing NODE_ENV fails closed as production", () => {
  assert.throws(() => validateEnvironment({
    DATABASE_URL: "postgresql://app:secret@db.example.com/sladex"
  }), /CORS_ORIGINS must be configured in production/);
});

test("blockchain configuration must provide RPC, chain ID, and registry together", () => {
  assert.throws(() => validateEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://sladex:local-dev-only@localhost:5432/sladex_dev",
    BLOCKCHAIN_CHAIN_ID: "31337"
  }), /BLOCKCHAIN_RPC_URL, BLOCKCHAIN_CHAIN_ID, and BLOCKCHAIN_REGISTRY_ADDRESS must be configured together/);
});

test("evidence anchoring requires a separate complete publisher configuration", () => {
  assert.throws(() => validateEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://sladex:local-dev-only@localhost:5432/sladex_dev",
    EVIDENCE_CHAIN_ID: "31337"
  }), /EVIDENCE_RPC_URL.*EVIDENCE_RELAYER_PRIVATE_KEY/);

  const result = validateEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://sladex:local-dev-only@localhost:5432/sladex_dev",
    EVIDENCE_RPC_URL: "http://127.0.0.1:8545",
    EVIDENCE_CHAIN_ID: "31337",
    EVIDENCE_REGISTRY_ADDRESS: `0x${"1".repeat(40)}`,
    EVIDENCE_RELAYER_PRIVATE_KEY: `0x${"2".repeat(64)}`
  });

  assert.equal(result.EVIDENCE_CHAIN_ID, 31337);
  assert.throws(() => validateEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://sladex:local-dev-only@localhost:5432/sladex_dev",
    BLOCKCHAIN_RPC_URL: "http://127.0.0.1:8545",
    BLOCKCHAIN_CHAIN_ID: "31337",
    BLOCKCHAIN_REGISTRY_ADDRESS: `0x${"3".repeat(40)}`,
    BLOCKCHAIN_RELAYER_PRIVATE_KEY: `0x${"2".repeat(64)}`,
    EVIDENCE_RPC_URL: "http://127.0.0.1:8545",
    EVIDENCE_CHAIN_ID: "31337",
    EVIDENCE_REGISTRY_ADDRESS: `0x${"4".repeat(40)}`,
    EVIDENCE_RELAYER_PRIVATE_KEY: `0x${"2".repeat(64)}`
  }), /account separate from the agreement relayer/);
});

test("rejects a configured relayer key that cannot derive a distinct EVM identity", () => {
  assert.throws(() => validateEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://sladex:local-dev-only@localhost:5432/sladex_dev",
    BLOCKCHAIN_RPC_URL: "http://127.0.0.1:8545",
    BLOCKCHAIN_CHAIN_ID: "31337",
    BLOCKCHAIN_REGISTRY_ADDRESS: `0x${"3".repeat(40)}`,
    BLOCKCHAIN_RELAYER_PRIVATE_KEY: `0x${"0".repeat(64)}`,
    EVIDENCE_RPC_URL: "http://127.0.0.1:8545",
    EVIDENCE_CHAIN_ID: "31337",
    EVIDENCE_REGISTRY_ADDRESS: `0x${"4".repeat(40)}`,
    EVIDENCE_RELAYER_PRIVATE_KEY: `0x${"2".repeat(64)}`
  }), /Invalid EVM relayer private key/);
});

test("webhook secret encryption key must be exactly 32 bytes", () => {
  assert.throws(() => validateEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://sladex:local-dev-only@localhost:5432/sladex_dev",
    MONITORING_SECRET_ENCRYPTION_KEY: "short"
  }), /MONITORING_SECRET_ENCRYPTION_KEY/);
});
