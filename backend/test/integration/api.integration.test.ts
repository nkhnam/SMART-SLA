import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import { MembershipRole } from "../../src/generated/prisma/client.js";
import { AppModule } from "../../src/app.module.js";
import { configureApplication } from "../../src/config/configure-app.js";
import { PrismaService } from "../../src/database/prisma.service.js";

const prefix = `integration-${randomUUID()}`;
const origin = "http://localhost:3000";
const apiPath = "/api/v1";
const mutationHeaders = { origin, "x-sla-csrf": "1", "content-type": "application/json" };
const registration = (suffix: string) => ({
  email: `${prefix}-${suffix}@example.test`,
  password: "Correct-Horse-Battery-92!",
  displayName: `Integration ${suffix}`,
  organizationName: `Integration Org ${suffix}`,
  organizationType: "CUSTOMER"
});
const agreementInput = {
  name: "Managed API service",
  serviceDescription: "Production API hosting and support",
  counterpartyDisplayName: "Unverified Counterparty Ltd",
  terms: {
    uptimeTargetPercent: 99.95,
    responseTimeTargetMs: 180,
    measurementWindowHours: 24,
    exclusions: ["Scheduled maintenance with notice"],
    notes: "Draft notes"
  }
};

let app: Awaited<ReturnType<typeof NestFactory.create>>;
let prisma: PrismaService;
let baseUrl: string;
let ownerCookie: string;
let ownerOrganizationId: string;
let ownerUserId: string;
let secondCookie: string;
let secondUserId: string;
let agreementId: string;

async function request(path: string, options: RequestInit = {}) {
  return fetch(`${baseUrl}${apiPath}${path}`, options);
}

async function register(input: ReturnType<typeof registration>) {
  const response = await request("/auth/register", {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify(input)
  });
  const payload = await response.json() as { organization?: { id: string }; user?: { id: string } };
  const cookie = response.headers.getSetCookie()[0]?.split(";", 1)[0];
  return { response, payload, cookie };
}

before(async () => {
  const expectedDatabase = new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  assert.match(expectedDatabase, /_test$/, "integration tests must only run against an isolated _test database");
  app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  prisma = app.get(PrismaService);
});

after(async () => {
  if (prisma) {
    const memberships = await prisma.membership.findMany({
      where: { user: { email: { startsWith: prefix } } },
      select: { userId: true, organizationId: true }
    });
    const userIds = [...new Set(memberships.map((membership) => membership.userId))];
    const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];
    if (organizationIds.length) {
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.agreement.deleteMany({ where: { ownerOrganizationId: { in: organizationIds } } });
      await prisma.membership.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (app) await app.close();
});

test("registration, login, duplicate handling, session reads, logout, and unauthenticated access", async () => {
  const created = await register(registration("owner"));
  assert.equal(created.response.status, 201);
  assert.ok(created.cookie);
  assert.ok(created.payload.organization?.id);
  assert.ok(created.payload.user?.id);
  ownerCookie = created.cookie!;
  ownerOrganizationId = created.payload.organization!.id;
  ownerUserId = created.payload.user!.id;

  const unauthenticated = await request("/organizations");
  assert.equal(unauthenticated.status, 401);

  const duplicate = await register({ ...registration("owner"), email: registration("owner").email.toUpperCase() });
  assert.equal(duplicate.response.status, 409);

  const invalidLogin = await request("/auth/login", {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({ email: registration("owner").email, password: "wrong-password" })
  });
  assert.equal(invalidLogin.status, 401);

  const organizationsResponse = await request("/organizations", { headers: { cookie: ownerCookie } });
  assert.equal(organizationsResponse.status, 200);
  const organizations = await organizationsResponse.json() as Array<{ id: string; role: string }>;
  assert.deepEqual(organizations.map(({ id, role }) => ({ id, role })), [{ id: ownerOrganizationId, role: "OWNER" }]);

  const current = await request("/auth/me", { headers: { cookie: ownerCookie } });
  assert.equal(current.status, 200);

  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { ...mutationHeaders, cookie: ownerCookie }
  });
  assert.equal(logout.status, 200);
  const revokedSession = await request("/auth/me", { headers: { cookie: ownerCookie } });
  assert.equal(revokedSession.status, 401);

  const login = await request("/auth/login", {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({ email: registration("owner").email, password: registration("owner").password })
  });
  assert.equal(login.status, 200);
  ownerCookie = login.headers.getSetCookie()[0]!.split(";", 1)[0]!;
  const loginSession = await prisma.session.findFirstOrThrow({ where: { userId: ownerUserId }, orderBy: { createdAt: "desc" } });
  await prisma.session.update({ where: { id: loginSession.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  const expiredSession = await request("/auth/me", { headers: { cookie: ownerCookie } });
  assert.equal(expiredSession.status, 401);

  const renewedLogin = await request("/auth/login", {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({ email: registration("owner").email, password: registration("owner").password })
  });
  assert.equal(renewedLogin.status, 200);
  ownerCookie = renewedLogin.headers.getSetCookie()[0]!.split(";", 1)[0]!;
});

test("validation rejects forged roles, malformed terms, and unrecognized organization IDs", async () => {
  const forgedRegistration = await register({ ...registration("forged"), role: "ADMIN" } as ReturnType<typeof registration>);
  assert.equal(forgedRegistration.response.status, 400);

  const inputWithOwnerId = { ...agreementInput, ownerOrganizationId };
  const forgedAgreement = await request("/agreements", {
    method: "POST",
    headers: { ...mutationHeaders, cookie: ownerCookie, "x-organization-id": ownerOrganizationId },
    body: JSON.stringify(inputWithOwnerId)
  });
  assert.equal(forgedAgreement.status, 400);

  const malformedTerms = await request("/agreements", {
    method: "POST",
    headers: { ...mutationHeaders, cookie: ownerCookie, "x-organization-id": ownerOrganizationId },
    body: JSON.stringify({ ...agreementInput, terms: { ...agreementInput.terms, uptimeTargetPercent: 101 } })
  });
  assert.equal(malformedTerms.status, 400);

  const unsupportedStatus = await request("/agreements", {
    method: "POST",
    headers: { ...mutationHeaders, cookie: ownerCookie, "x-organization-id": ownerOrganizationId },
    body: JSON.stringify({ ...agreementInput, status: "SIGNED" })
  });
  assert.equal(unsupportedStatus.status, 400);

  const forgedContext = await request("/agreements", {
    headers: { cookie: ownerCookie, "x-organization-id": randomUUID() }
  });
  assert.equal(forgedContext.status, 404);
});

test("drafts persist, revisions are immutable, stale edits conflict, and organizations stay isolated", async () => {
  const created = await request("/agreements", {
    method: "POST",
    headers: { ...mutationHeaders, cookie: ownerCookie, "x-organization-id": ownerOrganizationId },
    body: JSON.stringify(agreementInput)
  });
  assert.equal(created.status, 201);
  const agreement = await created.json() as { id: string; reference: string; version: number; terms: { uptimeTargetPercent: number } };
  agreementId = agreement.id;
  assert.equal(agreement.version, 1);
  assert.equal(agreement.terms.uptimeTargetPercent, 99.95);

  const secondUser = await register(registration("second"));
  assert.equal(secondUser.response.status, 201);
  secondCookie = secondUser.cookie!;
  const secondUserView = secondUser.payload.user;
  assert.ok(secondUserView?.id);
  secondUserId = secondUserView.id;

  const crossOrganizationRead = await request(`/agreements/${agreementId}`, {
    headers: { cookie: secondCookie, "x-organization-id": secondUser.payload.organization!.id }
  });
  assert.equal(crossOrganizationRead.status, 404);
  const crossOrganizationWrite = await request(`/agreements/${agreementId}`, {
    method: "PATCH",
    headers: { ...mutationHeaders, cookie: secondCookie, "x-organization-id": secondUser.payload.organization!.id },
    body: JSON.stringify({ ...agreementInput, expectedVersion: 1 })
  });
  assert.equal(crossOrganizationWrite.status, 404);

  await prisma.membership.create({
    data: { userId: secondUserId, organizationId: ownerOrganizationId, role: MembershipRole.MEMBER }
  });
  const memberWrite = await request(`/agreements/${agreementId}`, {
    method: "PATCH",
    headers: { ...mutationHeaders, cookie: secondCookie, "x-organization-id": ownerOrganizationId },
    body: JSON.stringify({ ...agreementInput, expectedVersion: 1 })
  });
  assert.equal(memberWrite.status, 403);

  const updatedInput = {
    ...agreementInput,
    name: "Managed API service revision",
    terms: { ...agreementInput.terms, responseTimeTargetMs: 200 },
    expectedVersion: 1
  };
  const concurrentUpdates = await Promise.all([
    request(`/agreements/${agreementId}`, {
      method: "PATCH",
      headers: { ...mutationHeaders, cookie: ownerCookie, "x-organization-id": ownerOrganizationId },
      body: JSON.stringify(updatedInput)
    }),
    request(`/agreements/${agreementId}`, {
      method: "PATCH",
      headers: { ...mutationHeaders, cookie: ownerCookie, "x-organization-id": ownerOrganizationId },
      body: JSON.stringify(updatedInput)
    })
  ]);
  assert.deepEqual(concurrentUpdates.map((response) => response.status).sort(), [200, 409]);

  const reloaded = await request(`/agreements/${agreementId}`, {
    headers: { cookie: ownerCookie, "x-organization-id": ownerOrganizationId }
  });
  assert.equal(reloaded.status, 200);
  const currentAgreement = await reloaded.json() as { version: number; name: string; terms: { responseTimeTargetMs: number } };
  assert.equal(currentAgreement.version, 2);
  assert.equal(currentAgreement.name, "Managed API service revision");
  assert.equal(currentAgreement.terms.responseTimeTargetMs, 200);

  const staleUpdate = await request(`/agreements/${agreementId}`, {
    method: "PATCH",
    headers: { ...mutationHeaders, cookie: ownerCookie, "x-organization-id": ownerOrganizationId },
    body: JSON.stringify(updatedInput)
  });
  assert.equal(staleUpdate.status, 409);

  const historyResponse = await request(`/agreements/${agreementId}/versions`, {
    headers: { cookie: ownerCookie, "x-organization-id": ownerOrganizationId }
  });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json() as Array<{ version: number; actor: { id: string } }>;
  assert.deepEqual(history.map((entry) => entry.version), [2, 1]);
  assert.deepEqual(history.map((entry) => entry.actor.id), [ownerUserId, ownerUserId]);

  const listResponse = await request("/agreements?page=1&pageSize=10&sort=createdAt&order=asc", {
    headers: { cookie: ownerCookie, "x-organization-id": ownerOrganizationId }
  });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json() as { data: Array<{ id: string }>; total: number };
  assert.equal(list.total, 1);
  assert.equal(list.data[0]?.id, agreementId);
});
