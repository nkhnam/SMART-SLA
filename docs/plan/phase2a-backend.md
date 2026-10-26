# Phase 2A Backend Implementation Plan

**Goal:** Add an authenticated, organization-scoped NestJS API backed by PostgreSQL for persistent agreement drafts while keeping the Phase 1 demo usable and clearly separate.

**Architecture:** A modular NestJS monolith owns identity, organizations, agreements, sessions, audit events, and health. Prisma migrations define normalized PostgreSQL records; immutable agreement-version rows hold explicit typed SLA terms. The existing frontend retains Demo Mode as its default and gains an explicit live workspace path that calls the API and reports failures without using fixtures.

**Tech Stack:** NestJS, TypeScript, PostgreSQL, Prisma, runtime schema validation, cookie sessions, OpenAPI, Next.js, and automated unit/integration checks.

---

## Execution decisions

- Keep the Phase 1 branch, `main`, and archive branch unchanged; implement on `feat/unihack-phase2-backend` from baseline `454847c38994e5ba9d5d8da8f4009b51d356d3fc`.
- Keep existing demo routes and their 12-route production smoke contract. Real data appears only after an explicit Live Workspace selection; Demo Mode remains fixture-only.
- Select an authorized organization per API request and verify current membership server-side. Never accept an owner organization, user ID, or role from agreement mutation bodies.
- Store only DRAFT agreements. Record every revision as a new immutable `AgreementVersion`; use the current version as the optimistic concurrency token.
- Do not implement signing, monitoring, disputes, verification, or blockchain operations.

## Tasks

### 1. Backend foundation

Create `backend/package.json`, TypeScript/Nest configuration, `backend/src/main.ts`, `backend/src/app.module.ts`, validated configuration, health endpoint, Swagger setup, `.env.example`, and a backend Docker Compose PostgreSQL service. Keep the API on port 4000 and frontend on port 3000. Establish scripts for lint, typecheck, unit tests, integration tests, build, Prisma generation, migration, and audit.

### 2. Persistence and migrations

Create `backend/prisma/schema.prisma` and a real initial migration for User, Organization, Membership, Session, Agreement, AgreementVersion, and AuditEvent. Model terms with explicit columns, enforce foreign keys and uniqueness, add list/authorization indexes, and seed no default credentials. Add an isolated test database configuration for local and CI use.

### 3. Authentication and organization authorization

Implement registration with organization onboarding, login, logout, current session, and organization listing. Use strong password hashing and opaque server-validated sessions in HttpOnly cookies. Configure strict CORS, SameSite/Secure cookie behavior, CSRF checks for unsafe requests, authentication throttling, safe errors, and membership verification for every private operation. Derive the initial OWNER role only in registration logic.

### 4. Agreement API

Implement paginated and safely sorted DRAFT list, create, read, update, and version-history endpoints. Validate typed SLA terms at the boundary. Scope every query by authorized organization. Create agreement and initial version atomically; update by compare-and-swap on version and append a new snapshot plus safe audit event in one transaction. Reject unsupported states and stale versions.

### 5. Frontend live workspace

Add typed API contracts and mapping functions in `frontend/lib/`. Keep demo fixtures isolated in Demo Mode. Add registration/login and explicit workspace selection, then connect live organization selection, agreement list/create/detail/edit/version views. Carry organization context in the API client, surface loading/empty/error/success states, and never fall back to demo records after an API error. Keep monitoring, disputes, and verification labeled Demo Mode.

### 6. Tests, CI, and documentation

Add focused unit and PostgreSQL integration tests for authentication, validation, session invalidation, organization isolation, role forgery, draft persistence, version history, and conflicting updates. Preserve all 12 production smoke routes and add frontend mapping/error-state coverage. Add a GitHub Actions workflow that starts an isolated PostgreSQL service, installs locked dependencies, applies migrations, runs backend/frontend checks, and audits dependencies. Update root setup instructions, current architecture documentation, and `docs/index.md`; document Fuji parameters as future-only boundaries.

### 7. Validation and delivery

Run backend clean install, lint, TypeScript checks, unit and integration tests, production build, and dependency audit; run frontend `npm ci`, lint, TypeScript checks, production build, 12-route production smoke, and dependency audit; run `git diff --check`. Do not claim browser E2E validation. Commit coherent completed changes without credit trailers. Push only `feat/unihack-phase2-backend` if all required validation succeeds.
