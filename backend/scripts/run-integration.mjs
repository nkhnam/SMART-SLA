import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://sladex_test:local-test-only@localhost:5433/sladex_test?schema=public";
const testDatabaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
assert.match(testDatabaseName, /_test$/, "TEST_DATABASE_URL must point to a database ending in _test");

const environment = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: testDatabaseUrl,
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? "http://localhost:3000"
};
const prismaCli = resolve(backendDirectory, "node_modules", "prisma", "build", "index.js");
const migration = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  cwd: backendDirectory,
  env: environment,
  stdio: "inherit"
});
if (migration.status !== 0) process.exit(migration.status ?? 1);

const tests = spawnSync(process.execPath, ["--test", "test/integration/api.integration.test.ts"], {
  cwd: backendDirectory,
  env: environment,
  stdio: "inherit"
});
process.exit(tests.status ?? 1);
