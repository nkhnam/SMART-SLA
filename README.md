# SLA-DEX

SLA-DEX pairs the Phase 1 fixture-backed demo with an opt-in live workspace. Phase 2A persists authenticated, organization-scoped agreement drafts in PostgreSQL. Phase 2B adds organization invitations, bilateral EIP-712 signing of immutable agreement versions, and a relayed Avalanche registry workflow. Phase 2C adds version-bound HTTP probes, signed provider webhooks, deterministic KPI evaluations, breach candidates, portable Merkle evidence packages, and a separately authorized EvidenceRegistry publisher. Disputes, arbitration, escrow, and settlement remain out of scope.

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

Open `http://localhost:3000/register` to create a local account and organization, or use `/login`. `/workspace/agreements` and `/workspace/monitoring` use live API data and report backend failures without substituting demo fixtures. Monitoring requires a confirmed, bilaterally signed agreement version. `/overview` and the existing Phase 1 routes stay in Demo Mode and need no backend. Local development database credentials are for local use only; configure production secrets and HTTPS origins separately.

## PostgreSQL integration tests

The integration runner refuses database names that do not end in `_test`. Start the isolated test database and run it with:

```bash
docker compose --profile test up -d postgres-test
cd backend
npm ci
npm run test:integration
```

See [docs/arch/phase2a-backend.md](docs/arch/phase2a-backend.md) for API, data, security, and future-chain boundaries.

## Phase 2B signing and registry

The Live Workspace uses the authenticated backend for invitation, wallet authorization, frozen snapshot review, signatures, anchoring and independent registry verification. Contract compilation and signing tests run on a local EVM; they do not need Fuji funds. See [the Phase 2B architecture](docs/arch/phase2b-avalanche.md), [signing threat model](docs/security/signing-threat-model.md), and [Fuji deployment guide](docs/deployment/fuji.md). Fuji deployment has not been performed and is not automatic in CI.

The `contracts/` workspace has its own `npm ci`, `npm run compile` and `npm test` commands. Evidence registry deployments use `npm run deploy:evidence:local`; the Fuji variant requires an explicit `EVIDENCE_PUBLISHER_ADDRESS`. Configure `AVALANCHE_FUJI_RPC_URL` and `AVALANCHE_FUJI_DEPLOYER_PRIVATE_KEY` securely only for an explicitly approved Fuji deployment; never commit private keys or put them in the frontend.

`AnchorIntent` stores the signed transaction, transaction hash, chain, relayer and nonce before broadcast. Recovery checks registry state and receipt first, rebroadcasts only those same bytes while the nonce is unused, and stops for manual reconciliation if another transaction consumed the nonce. To test a Phase 2A draft upgrade plus Phase 2B constraints, set `TEST_DATABASE_URL` to an isolated database name ending in `_test`, then run `npm run test:migration-upgrade` from `backend/`; the test creates and drops a temporary sibling database.

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

Browser automation was **NOT RUN** for the Phase 2B wallet and agreement flow. The browser tool was available, but PostgreSQL was unreachable and the frontend production build stopped with a filesystem `EPERM` error before the app could be exercised. Wallet account switching, Fuji network prompts, signature rejection, lifecycle refresh, console errors, keyboard behavior, real/Demo Mode separation and layouts at 375px, 768px and 1440px remain unverified. The HTTP smoke test is not a substitute for those browser checks.

Backend checks run from `backend/`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run test:integration`, and `npm audit`. Integration tests require the isolated PostgreSQL test service. Browser-only behavior and responsive rendering remain unverified.

See [docs/index.md](docs/index.md) for architecture and legacy inventory.

Phase 2C configuration adds `MONITORING_SECRET_ENCRYPTION_KEY` (32 random bytes encoded as 64 hex characters) and, when evidence anchoring is enabled, `EVIDENCE_RPC_URL`, `EVIDENCE_CHAIN_ID`, `EVIDENCE_REGISTRY_ADDRESS`, `EVIDENCE_RELAYER_PRIVATE_KEY`, and `EVIDENCE_CONFIRMATIONS`. The evidence relayer key must differ from the Phase 2B agreement relayer key. See the [monitoring architecture](docs/arch/phase2c-monitoring.md), [evidence format](docs/protocol/evidence-format.md), [oracle threat model](docs/security/oracle-threat-model.md), and [registry deployment guide](docs/deployment/evidence-registry.md).
