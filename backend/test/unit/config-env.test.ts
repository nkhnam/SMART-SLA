import assert from "node:assert/strict";
import { test } from "node:test";
import { validateEnvironment } from "../../src/config/env.schema.js";

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

test("webhook secret encryption key must be exactly 32 bytes", () => {
  assert.throws(() => validateEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://sladex:local-dev-only@localhost:5432/sladex_dev",
    MONITORING_SECRET_ENCRYPTION_KEY: "short"
  }), /MONITORING_SECRET_ENCRYPTION_KEY/);
});
