# SLA-DEX frontend

SLA-DEX is a frontend-only Phase 1 preview of verifiable SLA infrastructure on Avalanche. All workspace records are deterministic demo data; backend integrations and transaction submission are not implemented.

## Run locally

```bash
cd frontend
npm ci
npm run dev
```

The demo does not require environment variables or a backend. Routes include `/` (landing), `/overview`, `/agreements`, `/agreements/new`, `/agreements/[id]`, `/monitoring`, `/disputes`, `/verification`, and `/settings`.

## Validation

The standard production build uses Next.js's supported Webpack builder. On this checkout, Turbopack repeatedly exits while starting a CSS/PostCSS worker for `app/globals.css`; the worker exits with code 0 before connecting and emits no output. The failure reproduces both inside and outside the sandbox, while the Webpack build succeeds. Its root cause remains unresolved, so `npm run build:turbopack` is retained as a diagnostic command rather than the production build.

From `frontend/`, run these commands to reproduce the dependency, static, production-build, HTTP smoke and security checks:

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run build
npm run test:production-smoke
npm audit
npm audit --omit=dev
```

Run `npm run build:turbopack` separately to reproduce the local Turbopack worker failure. The production smoke script checks route responses, page-specific content, demo labels, internal navigation targets and disabled preview actions against the built application. It does not execute browser JavaScript or inspect rendered layout.

Browser automation was **NOT RUN**: local browser use is disabled in the current Work settings. In particular, JavaScript runtime errors, interactive navigation, keyboard behavior, horizontal overflow and layouts at 375px, 768px and 1440px remain unverified. The HTTP smoke test is not a substitute for those browser checks.

Remaining frontend quality risks are the unresolved Turbopack worker failure and unverified browser-only behavior and responsive rendering. No Phase 2 backend or blockchain integration is present.

See [docs/index.md](docs/index.md) for architecture and legacy inventory.
