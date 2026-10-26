# SLA-DEX

SLA-DEX pairs the Phase 1 fixture-backed demo with an opt-in Phase 2A live workspace for authenticated, organization-scoped agreement drafts. The live API persists drafts in PostgreSQL; signing, monitoring, disputes, verification, and blockchain transactions remain future work.

## Run the live workspace locally

Requirements: Node.js 24.15+ and Docker Compose.

```bash
docker compose up -d postgres
cd backend
npm ci
Copy-Item .env.example .env
npm run db:migrate:dev
npm run dev
```

In another terminal:

```bash
cd frontend
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000/register` to create a local account and organization, or use `/login`. `/workspace/agreements` uses live API data and reports backend failures without substituting demo fixtures. `/overview` and the existing Phase 1 routes stay in Demo Mode and need no backend. Local development database credentials are for local use only; configure production secrets and HTTPS origins separately.

## PostgreSQL integration tests

The integration runner refuses database names that do not end in `_test`. Start the isolated test database and run it with:

```bash
docker compose --profile test up -d postgres-test
cd backend
npm ci
npm run test:integration
```

See [docs/arch/phase2a-backend.md](docs/arch/phase2a-backend.md) for API, data, security, and future-chain boundaries.

## Validation

The standard production build uses Next.js's supported Webpack builder. On this checkout, Turbopack repeatedly exits while starting a CSS/PostCSS worker for `app/globals.css`; the worker exits with code 0 before connecting and emits no output. The failure reproduces both inside and outside the sandbox, while the Webpack build succeeds. Its root cause remains unresolved, so `npm run build:turbopack` is retained as a diagnostic command rather than the production build.

From `frontend/`, run these commands for frontend dependency, static, API mapping, production-build, HTTP smoke, and security checks:

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run test:api
npm run build
npm run test:production-smoke
npm audit
npm audit --omit=dev
```

Run `npm run build:turbopack` separately to reproduce the local Turbopack worker failure. The production smoke script checks the original 12 Phase 1 routes, page-specific content, demo labels, internal navigation targets and disabled preview actions against the built application. It does not execute browser JavaScript or inspect rendered layout.

Browser automation was **NOT RUN**: local browser use is disabled in the current Work settings. In particular, JavaScript runtime errors, interactive navigation, keyboard behavior, horizontal overflow and layouts at 375px, 768px and 1440px remain unverified. The HTTP smoke test is not a substitute for those browser checks.

Backend checks run from `backend/`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run test:integration`, and `npm audit`. Integration tests require the isolated PostgreSQL test service. Browser-only behavior and responsive rendering remain unverified.

See [docs/index.md](docs/index.md) for architecture and legacy inventory.
