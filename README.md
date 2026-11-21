# SMART-SLA

SMART-SLA pairs the Phase 1 fixture-backed demo with an opt-in live workspace. Phase 2A persists authenticated, organization-scoped agreement drafts in PostgreSQL. Phase 2B adds organization invitations, bilateral EIP-712 signing of immutable agreement versions, and a relayed Avalanche registry workflow. Phase 2C adds version-bound HTTP probes, signed provider webhooks, deterministic KPI evaluations, breach candidates, portable Merkle evidence packages, and a separately authorized EvidenceRegistry publisher. Disputes, arbitration, escrow, and settlement remain out of scope.

## Try the demo

For a UI walkthrough without a database or wallet, run `npm ci` then `npm run dev` from `frontend/` and open `http://localhost:3000/overview`. These routes use labeled fixtures. Use the Live Workspace below to exercise authenticated persistence, signing and monitoring; its API failures are never replaced with fixture data.

The [competition submission guide](docs/competition/submission-guide.md) maps the organizer rubric to a 2–3 minute demo and required submission materials. Local EVM verification and a Fuji deployment are distinct milestones; record public transaction receipts before claiming that the application is deployed on Avalanche.

### Competition deliverables

- [Pitch deck (PPTX — ready to import to Google Slides / Canva)](docs/competition/deliverables/SMART-SLA-Pitch-UniHack.pptx)
- [Pitch deck (PDF)](docs/competition/deliverables/SMART-SLA-Pitch-UniHack.pdf)
- [Demo video (2–3 min MP4, Vietnamese narration on Local EVM 31337 + synthetic telemetry)](docs/competition/deliverables/SMART-SLA-Demo-UniHack.mp4)

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

Both local services should use the same hostname (`localhost` in these instructions) so session cookies and the configured CORS origin agree. Docker Compose binds the development and test database ports to `127.0.0.1`. To invite a second organization, share the organization ID displayed in the workspace header. Complete the agreement and evidence registry configuration described below before attempting live anchoring; creating local accounts and drafts does not require blockchain keys.

## PostgreSQL integration tests

The integration runner refuses database names that do not end in `_test`. Start the isolated test database and run it with:

```bash
docker compose --profile test up -d postgres-test
cd backend
npm ci
npm run test:integration
```

Phase 2C has separate reproducible gates: [Gate 2 synthetic full-stack acceptance](docs/ref/phase2c-acceptance.md), [Gate 3A worker reliability](docs/ref/monitoring-worker-reliability.md), [Gate 3B evidence-publisher recovery](docs/ref/evidence-publisher-reliability.md), [Gate 3C authenticated browser flows](docs/ref/monitoring-browser-flows.md), and [Gate 3D real public HTTPS collection](docs/ref/public-https-acceptance.md). Each uses isolated PostgreSQL; the evidence gates also use a private local EVM. These checks do not establish full Phase 2C or production readiness.

See [docs/arch/phase2a-backend.md](docs/arch/phase2a-backend.md) for API, data, security, and future-chain boundaries.

## Phase 2B signing and registry

The Live Workspace uses the authenticated backend for invitation, wallet authorization, frozen snapshot review, signatures, anchoring and independent registry verification. Contract compilation and signing tests run on a local EVM; they do not need Fuji funds. See [the Phase 2B architecture](docs/arch/phase2b-avalanche.md), [signing threat model](docs/security/signing-threat-model.md), and [Fuji deployment guide](docs/deployment/fuji.md).

### Avalanche Fuji C-Chain (`43113`) Deployment (verified 2026-11-21)

Both registries are deployed on Avalanche Fuji (`43113`) from `FUJI_DEPLOYER_ADDRESS` (`0x7d22b94e893c88Fc48e1B5AaC38a491a171Af0D2`):

| Contract | Fuji Address | Deployment Transaction | Block | Configured `publisher()` |
| --- | --- | --- | --- | --- |
| `AgreementRegistry` | [`0x9F5923a2005c41c84cBa1cDE1f1eBa5BE5bDC04`](https://testnet.snowtrace.io/address/0x9F5923a2005c41c84cBa1cDE1f1eBa5BE5bDC04) | [`0xbe64c75b...9af756b`](https://testnet.snowtrace.io/tx/0xbe64c75b005f9ef10d9bc855964b84c93e5d5e29351d851f9dbf7d96e9af756b) (`nonce: 0`) | `61414814` | `0xb1f095aD1C01f1901B3aFea07C2d7b486f8b820D` |
| `EvidenceRegistry` | [`0xB712c0632E4B7AbB1E63a44aBB4d7B95f580b7cA`](https://testnet.snowtrace.io/address/0xB712c0632E4B7AbB1E63a44aBB4d7B95f580b7cA) | [`0x2069c140...3e72c09`](https://testnet.snowtrace.io/tx/0x2069c1407c218bcdecc3f071a106affd1df76b79f7508b78811b9b6d83e72c09) (`nonce: 1`) | `61415103` | `0x0bFE801204390b0216Dc2A29FA11417B22d571D1` |

Both contracts passed keyless `POST_DEPLOYMENT_IDENTITY` verification (`npm run preflight:fuji` at block `61415157`, `READ_ONLY_CHECKS_PASS_SEPARATE_APPROVAL_REQUIRED`, `blockers: []`): runtime bytecodes match the compiled artifacts (`solc 0.8.38`, Cancun, optimizer `200`, excluding immutable slots for `AgreementRegistry`), `owner()` and `publisher()` match the configured roles, the `AgreementRegistry` EIP-712 domain (`name="SLA-DEX Agreement Registry"`, `version="1"`, `chainId=43113`) matches, and both blocks/bytecodes match across two independent Fuji RPCs (`api.avax-test.network` and `avalanche-fuji-c-chain-rpc.publicnode.com`).

**Operational boundary:** The online relayer accounts (`0xb1f0...820D`, `0x0bFE...71D1`) are currently unfunded (`0 AVAX`), hosted Fuji backend workers are not yet activated, and Snowtrace explorer source verification has not been submitted yet. The recorded full-stack browser walkthrough in `docs/competition/deliverables/SMART-SLA-Demo-UniHack.mp4` runs on Local EVM (`31337`) with synthetic telemetry. Full deployment hashes and gas records are documented in [the Fuji deployment runbook](docs/deployment/fuji.md#deployment-record-2026-11-21).

The `contracts/` workspace has `npm ci`, `npm run compile`, `npm run typecheck` and `npm test` commands. `npm run preflight:fuji` reads Fuji, artifacts and public roles without loading keys, signing or broadcasting; missing prerequisites return `NO_GO`. Both Fuji deployment scripts require actual chain 43113, five distinct public roles, the matching dedicated deployer key and `FUJI_DEPLOYMENT_APPROVED=43113` in a separately approved session. The contracts `.env.example` does not automatically load variables; inject them securely into the process. See the [Gate 4A audit](docs/research/fuji-preflight.md), [Fuji runbook](docs/deployment/fuji.md), and [implemented agreement confirmation policy](docs/ref/agreement-confirmation.md). Gate 4A.1 hosted CI verification, online relayer funding, and separate backend worker activation remain gated prerequisites for public Fuji runtime operation. `deploy:evidence:local` uses an ephemeral chain; use `--network localEvm` for a running node. Local CI uses public test-only accounts and private EVMs; synthetic outage values are controlled inputs, not real outages.

`AnchorIntent` stores the signed transaction, transaction hash, chain, relayer and nonce before broadcast. Recovery checks registry state and receipt first, rebroadcasts only those same bytes while the nonce is unused, and stops for manual reconciliation if another transaction consumed the nonce. To test a Phase 2A draft upgrade plus Phase 2B constraints, set `TEST_DATABASE_URL` to an isolated database name ending in `_test`, then run `npm run test:migration-upgrade` from `backend/`; the test creates and drops a temporary sibling database.

## Validation

The standard development and production commands (`npm run dev` and `npm run build`) use Next.js's supported Webpack builder. On this checkout, Turbopack repeatedly exits while starting a CSS/PostCSS worker for `app/globals.css`; the worker exits with code 0 before connecting and emits no output. The failure reproduces both inside and outside the sandbox, while the Webpack build succeeds. Its root cause remains unresolved, so `npm run dev:turbopack` and `npm run build:turbopack` are retained as diagnostic commands rather than the primary workflow.

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

The standalone UI regression spec uses mocked API responses for organization IDs, readable signed terms, pagination and responsive layout. Install Playwright's pinned Chromium before running it. From `frontend/` in PowerShell:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:4000/api/v1"
npm run build
npx playwright install chromium --only-shell
npx playwright test tests/e2e/workspace-review.spec.ts --workers=1
```

These isolated UI cases need no backend or EVM. Use the live browser gates below to exercise authenticated persistence and signing.

The Playwright suite covers Phase 2B wallet/signing regressions and Gate 3C authenticated source management, secret rotation, role/organization/version boundaries, sparse KPI evaluation and evidence download. Responsive cases run at 375px, 768px and 1440px. Use the GitHub Actions result for the exact commit as the hosted verdict. Gate 3D is an opt-in real-network command, excluded from deterministic CI; it retains DNS/network diagnostics and exits nonzero when no healthy HTTPS response was observed. See its reference for commands, provenance and limitations.

Backend checks run from `backend/`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run test:integration`, and `npm audit`. Integration tests require the isolated PostgreSQL test service. Browser and responsive verification are covered by the dedicated Playwright command and hosted workflow, with results tied to their tested commit.

See [docs/index.md](docs/index.md) for architecture and legacy inventory.

Phase 2C configuration adds `MONITORING_SECRET_ENCRYPTION_KEY` (32 random bytes encoded as 64 hex characters) and, when evidence anchoring is enabled, `EVIDENCE_RPC_URL`, `EVIDENCE_CHAIN_ID`, `EVIDENCE_REGISTRY_ADDRESS`, `EVIDENCE_RELAYER_PRIVATE_KEY`, and `EVIDENCE_CONFIRMATIONS`. Configuration rejects invalid relayer keys and rejects the publisher if its derived EVM address matches the Phase 2B agreement relayer address. See the [monitoring architecture](docs/arch/phase2c-monitoring.md), [evidence format](docs/protocol/evidence-format.md), [oracle threat model](docs/security/oracle-threat-model.md), and [registry deployment guide](docs/deployment/evidence-registry.md).
