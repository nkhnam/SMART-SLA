# Phase 2A backend foundation

updated 2026-10-26 · 454847c

Phase 2A adds authenticated, organization-scoped persistence for SLA agreement drafts. The existing fixture-backed routes remain an independent Demo Mode. Phase 2A does not sign agreements, verify evidence, monitor services, manage disputes, settle payments, or submit blockchain transactions.

## Runtime boundaries

| Component | Owns | Boundary |
|---|---|---|
| `backend/` NestJS API | Auth, memberships, draft agreements, immutable versions, audit events, health | `/api/v1`; PostgreSQL through Prisma 7 and the PostgreSQL driver adapter |
| `frontend/` Next.js | Demo Mode and opt-in Live Workspace | Live requests use `NEXT_PUBLIC_API_BASE_URL`, cookie credentials, and the selected organization ID |
| PostgreSQL | Users, organizations, memberships, sessions, agreements, agreement versions, audit events | Local development and isolated integration-test databases use separate Compose services and credentials |

The API applies validated environment configuration, Helmet, exact-origin credentialed CORS, a CSRF origin/header check for unsafe methods, global validation, Swagger, a global request limit, and tighter authentication throttles. Production requires HTTPS CORS origins; the session cookie is HttpOnly, SameSite=Strict, scoped to `/api/v1`, and Secure in production. Sessions use random opaque tokens; only SHA-256 token hashes are stored. Passwords use Argon2id.

## API surface

| Route | Purpose |
|---|---|
| `GET /api/v1/health` | Database-backed health probe |
| `POST /api/v1/auth/register` | Create user, organization, OWNER membership, audit event, and session atomically |
| `POST /api/v1/auth/login` | Start an opaque server-validated session |
| `POST /api/v1/auth/logout` | Revoke the current session |
| `GET /api/v1/auth/me` | Read the current authenticated user and session expiry |
| `GET /api/v1/organizations` | List organizations for current memberships |
| `GET /api/v1/agreements` | Paginated DRAFT list with safe `createdAt`/`updatedAt` sort and creation-time filters |
| `POST /api/v1/agreements` | Create a DRAFT and immutable version 1 |
| `GET /api/v1/agreements/:id` | Read a DRAFT in the selected organization |
| `PATCH /api/v1/agreements/:id` | Compare expected version, append a snapshot, and audit atomically |
| `GET /api/v1/agreements/:id/versions` | Read immutable snapshots and actor names |

Every private agreement request resolves `X-Organization-Id` against the authenticated user’s current membership. The API derives user and role from server-side state; mutations do not accept owner organization, actor, role, or status. OWNER and ADMIN can write; MEMBER is read-only. A stale edit returns conflict rather than overwriting a newer snapshot. API failures never return demo fixture data.

## Stored data

`backend/prisma/schema.prisma` defines `User`, `Organization`, `Membership`, `Session`, `Agreement`, `AgreementVersion`, and `AuditEvent`. Agreement terms are typed columns with bounded numeric values. Agreement versions are append-only by service behavior and have a unique `(agreementId, version)` constraint. Organization ownership and versions have database foreign keys; organization/time and session-expiry lookup paths are indexed. The initial migration is committed under `backend/prisma/migrations/`.

## Local operation and tests

- Start the development database with `docker compose up -d postgres`.
- Start the isolated test database with `docker compose --profile test up -d postgres-test`; the integration runner refuses a database name without the `_test` suffix.
- Set `backend/.env` from `backend/.env.example`, run `npm ci`, `npm run db:migrate:dev`, then `npm run dev`.
- Start the frontend with `frontend/.env.local` copied from `frontend/.env.example`; registration starts at `/register` and live drafts are under `/workspace/agreements`.
- CI runs lint, typechecks, unit and PostgreSQL integration tests, builds, dependency audit, and the original 12-route frontend production smoke suite.

## Future-only Avalanche Fuji boundary

Fuji C-Chain details are reference values for a later verification integration, not an enabled Phase 2A dependency: network name `Avalanche Fuji C-Chain`, chain ID `43113` (`0xA869`), native currency `AVAX`, RPC `https://api.avax-test.network/ext/bc/C/rpc`, and Explorer `https://explorer-test.avax.network/c-chain`. [Avalanche Builder Hub network table](https://build.avax.network/docs/primary-network) was checked on 2026-10-26. Phase 2A has no wallet connector, chain SDK, contract address, signer, RPC client, or on-chain status claim; a future chain phase must select contract and verification/finality rules before presenting chain state.
