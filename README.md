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

From `frontend/`, run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.

See [docs/index.md](docs/index.md) for architecture and legacy inventory.
