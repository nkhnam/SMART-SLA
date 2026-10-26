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
