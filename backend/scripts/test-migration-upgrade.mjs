import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;
const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://sladex_test:local-test-only@localhost:5433/sladex_test?schema=public";
const baseUrl = new URL(testDatabaseUrl);
const sourceDatabase = baseUrl.pathname.replace(/^\//, "");
assert.match(sourceDatabase, /_test$/, "TEST_DATABASE_URL must point to a database ending in _test");

const databaseName = `sladex_upgrade_${randomUUID().replaceAll("-", "")}_test`;
const adminUrl = new URL(baseUrl);
adminUrl.pathname = "/postgres";
const upgradeUrl = new URL(baseUrl);
upgradeUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl.toString() });
const upgrade = new Client({ connectionString: upgradeUrl.toString() });
const phase2aMigration = "20261026000000_phase2a_foundation";
const migrationDirectory = resolve(backendDirectory, "prisma", "migrations", phase2aMigration);
const prismaCli = resolve(backendDirectory, "node_modules", "prisma", "build", "index.js");
const ids = {
  owner: "0b847a83-7b9f-4c99-8803-7e7607a1e228",
  customer: "3ebf6e45-1c81-4e68-9510-13c6cfb6c9a7",
  supplier: "b0f2af02-399f-4bd2-b8cb-1c818de6d4fc",
  draft: "cd1965ea-2f7b-41cb-9b7e-0d2623b0b2f4",
  testAgreement: "083ac6f6-9524-4ed2-b935-017be750c791",
  versionOne: "7ee26d2c-6829-4b80-bc4b-bdc70728e6e7",
  versionTwo: "4d2444a8-6050-4e7e-8f35-998e714a20de",
  testVersion: "11111111-2222-4333-8444-555555555555",
  customerSigner: "801ad0a5-5b1f-490c-b356-2bb0a67ab341",
  supplierSigner: "9e186c0b-6493-4290-95ce-286caab883a3",
  snapshot: "42380d34-2d5a-4e1c-890a-5c3f1b1f9d91"
};

function migrate(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: backendDirectory,
    env: { ...process.env, DATABASE_URL: upgradeUrl.toString(), NODE_ENV: "test" },
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`Prisma migration command failed: ${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function expectSqlState(operation, expectedCode) {
  await assert.rejects(operation, (error) => error.code === expectedCode);
}

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await upgrade.connect();
  const migrationSql = await readFile(resolve(migrationDirectory, "migration.sql"), "utf8");
  await upgrade.query(migrationSql);
  migrate(["migrate", "resolve", "--applied", phase2aMigration]);

  await upgrade.query("BEGIN");
  await upgrade.query(`INSERT INTO "User" ("id", "email", "passwordHash", "displayName", "updatedAt") VALUES ($1, 'owner@example.test', 'test-only-hash', 'Upgrade Owner', NOW())`, [ids.owner]);
  await upgrade.query(`INSERT INTO "Organization" ("id", "name", "organizationType", "updatedAt") VALUES ($1, 'Upgrade Customer', 'CUSTOMER', NOW()), ($2, 'Upgrade Supplier', 'PROVIDER', NOW())`, [ids.customer, ids.supplier]);
  await upgrade.query(`INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "updatedAt") VALUES ($1, $2, $3, 'OWNER', NOW()), ($4, $2, $5, 'OWNER', NOW())`, [randomUUID(), ids.owner, ids.customer, randomUUID(), ids.supplier]);
  await upgrade.query(`INSERT INTO "Agreement" ("id", "reference", "ownerOrganizationId", "createdByUserId", "version", "updatedAt") VALUES ($1, 'UPGRADE-DRAFT', $2, $3, 2, NOW())`, [ids.draft, ids.customer, ids.owner]);
  await upgrade.query(`INSERT INTO "AgreementVersion" ("id", "agreementId", "version", "actorUserId", "name", "serviceDescription", "counterpartyDisplayName", "uptimeTargetPercent", "responseTimeTargetMs", "measurementWindowHours") VALUES ($1, $2, 1, $3, 'Original draft v1', 'Version one terms', 'Upgrade Supplier', 99.95, 200, 24), ($4, $2, 2, $3, 'Original draft v2', 'Version two terms', 'Upgrade Supplier', 99.90, 180, 24)`, [ids.versionOne, ids.draft, ids.owner, ids.versionTwo]);
  await upgrade.query("COMMIT");

  const migrationOutput = migrate(["migrate", "deploy"]);
  assert.match(migrationOutput, /20261026100000_phase2b_signing/);
  assert.match(migrationOutput, /20261026120000_reliable_anchor_submission/);

  const originalDraft = await upgrade.query(`
    SELECT agreement."id", agreement."reference", agreement."status"::text, agreement."version",
           agreement."signatureStatus"::text, agreement."blockchainStatus"::text,
           array_agg(version."name" ORDER BY version."version") AS "versionNames"
    FROM "Agreement" agreement
    JOIN "AgreementVersion" version ON version."agreementId" = agreement."id"
    WHERE agreement."id" = $1
    GROUP BY agreement."id"
  `, [ids.draft]);
  assert.deepEqual(originalDraft.rows[0], {
    id: ids.draft,
    reference: "UPGRADE-DRAFT",
    status: "DRAFT",
    version: 2,
    signatureStatus: "NOT_STARTED",
    blockchainStatus: "NOT_QUEUED",
    versionNames: ["Original draft v1", "Original draft v2"]
  });

  await upgrade.query(`INSERT INTO "Agreement" ("id", "reference", "ownerOrganizationId", "createdByUserId", "updatedAt") VALUES ($1, 'CONSTRAINT-CHECK', $2, $3, NOW())`, [ids.testAgreement, ids.customer, ids.owner]);
  await upgrade.query(`INSERT INTO "AgreementVersion" ("id", "agreementId", "version", "actorUserId", "name", "serviceDescription", "counterpartyDisplayName", "uptimeTargetPercent", "responseTimeTargetMs", "measurementWindowHours") VALUES ($1, $2, 1, $3, 'Constraint fixture', 'Fixture terms', 'Upgrade Supplier', 99.99, 100, 24)`, [ids.testVersion, ids.testAgreement, ids.owner]);
  await upgrade.query(`INSERT INTO "AuthorizedSigner" ("id", "organizationId", "userId", "address") VALUES ($1, $2, $3, '0x0000000000000000000000000000000000000001'), ($4, $5, $3, '0x0000000000000000000000000000000000000002')`, [ids.customerSigner, ids.customer, ids.owner, ids.supplierSigner, ids.supplier]);
  await upgrade.query(`INSERT INTO "SigningSnapshot" ("id", "agreementId", "version", "buyerOrganizationId", "supplierOrganizationId", "buyerSigner", "supplierSigner", "buyerAuthorizedSignerId", "supplierAuthorizedSignerId", "canonicalPayload", "snapshotHash", "agreementKey", "validUntil") VALUES ($1, $2, 1, $3, $4, '0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002', $5, $6, '{}', $7, $8, NOW() + INTERVAL '1 day')`, [ids.snapshot, ids.testAgreement, ids.customer, ids.supplier, ids.customerSigner, ids.supplierSigner, `0x${"ab".repeat(32)}`, `0x${"cd".repeat(32)}`]);

  await upgrade.query(`INSERT INTO "AgreementInvitation" ("id", "agreementId", "agreementVersion", "inviterOrganizationId", "invitedOrganizationId", "invitedByUserId", "expiresAt") VALUES ($1, $2, 1, $3, $4, $5, NOW() + INTERVAL '1 day')`, [randomUUID(), ids.testAgreement, ids.customer, ids.supplier, ids.owner]);
  await expectSqlState(upgrade.query(`INSERT INTO "AgreementInvitation" ("id", "agreementId", "agreementVersion", "inviterOrganizationId", "invitedOrganizationId", "invitedByUserId", "expiresAt") VALUES ($1, $2, 1, $3, $4, $5, NOW() + INTERVAL '1 day')`, [randomUUID(), ids.testAgreement, ids.customer, ids.supplier, ids.owner]), "23505");

  await upgrade.query(`INSERT INTO "AgreementSignature" ("id", "snapshotId", "party", "authorizedSignerId", "signerAddress", "signature", "digest") VALUES ($1, $2, 'BUYER', $3, '0x0000000000000000000000000000000000000001', $4, $5)`, [randomUUID(), ids.snapshot, ids.customerSigner, `0x${"11".repeat(65)}`, `0x${"aa".repeat(32)}`]);
  await expectSqlState(upgrade.query(`INSERT INTO "AgreementSignature" ("id", "snapshotId", "party", "authorizedSignerId", "signerAddress", "signature", "digest") VALUES ($1, $2, 'BUYER', $3, '0x0000000000000000000000000000000000000001', $4, $5)`, [randomUUID(), ids.snapshot, ids.customerSigner, `0x${"22".repeat(65)}`, `0x${"bb".repeat(32)}`]), "23505");

  await upgrade.query(`INSERT INTO "AnchorIntent" ("id", "snapshotId", "idempotencyKey", "updatedAt") VALUES ($1, $2, 'constraint-op-1', NOW())`, [randomUUID(), ids.snapshot]);
  await expectSqlState(upgrade.query(`INSERT INTO "AnchorIntent" ("id", "snapshotId", "idempotencyKey", "updatedAt") VALUES ($1, $2, 'constraint-op-2', NOW())`, [randomUUID(), ids.snapshot]), "23505");
  await expectSqlState(upgrade.query(`INSERT INTO "AgreementInvitation" ("id", "agreementId", "agreementVersion", "inviterOrganizationId", "invitedOrganizationId", "invitedByUserId", "expiresAt") VALUES ($1, $2, 99, $3, $4, $5, NOW() + INTERVAL '1 day')`, [randomUUID(), randomUUID(), ids.customer, ids.supplier, ids.owner]), "23503");
  await expectSqlState(upgrade.query(`INSERT INTO "AgreementVersion" ("id", "agreementId", "version", "actorUserId", "name", "serviceDescription", "counterpartyDisplayName", "uptimeTargetPercent", "responseTimeTargetMs", "measurementWindowHours") VALUES ($1, $2, 1, $3, 'duplicate', 'terms', 'supplier', 99.0, 200, 24)`, [randomUUID(), ids.testAgreement, ids.owner]), "23505");

  await upgrade.query("BEGIN");
  await upgrade.query(`INSERT INTO "AgreementInvitation" ("id", "agreementId", "agreementVersion", "inviterOrganizationId", "invitedOrganizationId", "invitedByUserId", "expiresAt") VALUES ($1, $2, 2, $3, $4, $5, NOW() + INTERVAL '1 day')`, [randomUUID(), ids.testAgreement, ids.customer, ids.supplier, ids.owner]);
  await expectSqlState(upgrade.query(`INSERT INTO "AgreementParticipant" ("id", "agreementId", "agreementVersion", "organizationId", "role") VALUES ($1, $2, 1, $3, 'BUYER')`, [randomUUID(), ids.testAgreement, randomUUID()]), "23503");
  await upgrade.query("ROLLBACK");
  const rolledBackInvite = await upgrade.query(`SELECT count(*)::int AS count FROM "AgreementInvitation" WHERE "agreementId" = $1 AND "agreementVersion" = 2`, [ids.testAgreement]);
  assert.equal(rolledBackInvite.rows[0].count, 0);

  await expectSqlState(upgrade.query(`DELETE FROM "AgreementVersion" WHERE "agreementId" = $1 AND "version" = 1`, [ids.testAgreement]), "23503");
  const oldDraftSigningRows = await upgrade.query(`SELECT (SELECT count(*) FROM "AgreementInvitation" WHERE "agreementId" = $1)::int AS invitations, (SELECT count(*) FROM "SigningSnapshot" WHERE "agreementId" = $1)::int AS snapshots, (SELECT count(*) FROM "AgreementSignature" signature JOIN "SigningSnapshot" snapshot ON snapshot."id" = signature."snapshotId" WHERE snapshot."agreementId" = $1)::int AS signatures, (SELECT count(*) FROM "AnchorIntent" intent JOIN "SigningSnapshot" snapshot ON snapshot."id" = intent."snapshotId" WHERE snapshot."agreementId" = $1)::int AS intents`, [ids.draft]);
  assert.deepEqual(oldDraftSigningRows.rows[0], { invitations: 0, snapshots: 0, signatures: 0, intents: 0 });

  console.log("Phase 2A draft upgrade, Phase 2B constraints and rollback checks passed.");
} finally {
  if (!upgrade.ended) await upgrade.end().catch(() => undefined);
  if (admin.readyForQuery) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}
