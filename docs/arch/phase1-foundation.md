# Phase 1 frontend foundation

updated 2026-10-26 v2-phase1

SLA-DEX Phase 1 is a frontend-only product foundation for verifiable SLA infrastructure on Avalanche. Screens communicate intended flows and use deterministic examples. No action writes to a backend, submits a blockchain transaction, or settles money.

## Current frontend architecture

- Next.js App Router, React, TypeScript, and Tailwind CSS v4 live under `frontend/`.
- Route pages compose the shared app shell and screen components. The shell owns the graphite navigation, active route state, responsive navigation, organization context, and the Demo Data label.
- Shared visual primitives and navigation live under `frontend/components/`; typed static fixtures and cross-page selectors live under `frontend/lib/demo-data.ts`.
- There is no API client, session store, wallet connector, runtime environment dependency, server action, or backend proxy in the Phase 1 UI.
- Routes: `/` landing, `/overview` dashboard, `/agreements` list, `/agreements/[id]` detail preview, `/agreements/new` creation preview, `/monitoring`, `/disputes`, `/verification`, and `/settings`.

## Design system

The interface uses a light canvas with graphite navigation, white surfaces, fine neutral borders, readable ink, and restrained Avalanche red for primary actions and trust markers. Tokens are defined once in `frontend/app/globals.css`. Tailwind utilities provide layout and spacing; shared components provide repeated navigation, badges, cards, metrics, section headings, and demo labels. Focus visibility, semantic landmarks, keyboard-operable links, responsive grids, and reduced-motion support are part of the baseline.

## Demo data contract

`frontend/lib/demo-data.ts` is the source of truth. It exports strongly typed organizations, agreements, incidents, disputes, verification records, and monitoring observations. Foreign keys refer to IDs in those shared fixtures. Selectors derive counts and related entities rather than duplicating values. Data is deterministic and all views identify it as Demo Data. Creation, challenge, resolve, verification, organization, and chain actions are previews; controls are disabled or explicitly marked as unavailable until a future backend exists. A displayed hash or anchor is fixture evidence context and must not be described as a successful live transaction.

## Future backend modules and API boundaries

Phase 2 may introduce these modules behind typed, server-side boundaries:

| Module | Owns | UI boundary |
|---|---|---|
| Identity and organizations | Membership, roles, organization preferences | Session and organization read/update contract; enforce access on server. |
| Agreements | Drafts, terms, versions, signatures | Agreement list/detail/create/update API; validate terms before persistence. |
| Monitoring | Source registration, measurements, KPI aggregation | Read-only observations and source configuration API; secrets stay server-side. |
| Incidents and disputes | Breach evidence, challenge window, adjudication | Incident/dispute lifecycle API with explicit state and evidence references. |
| Verification | Avalanche anchoring and independent proof checks | Submit/receipt/status API with chain/network identity; UI distinguishes pending, confirmed, and failed. |
| Notifications and audit | User notices and immutable application audit events | Paginated read APIs and explicit acknowledgement actions. |

No backend framework, chain SDK, schema, or transaction workflow is selected by this Phase 1 document.

## Phase 2 integration requirements

- Replace fixture selectors with typed API adapters while preserving the UI-facing contracts and loading, empty, and error states.
- Define authentication, organization scoping, authorization, pagination, validation, idempotency, and audit behavior before enabling mutations.
- Select and document Avalanche network, contract address/version, event schema, confirmation/finality policy, retry behavior, and independent verification requirements before presenting chain state.
- Keep signing, API secrets, monitoring credentials, evidence storage, and transaction submission out of public client bundles.
- Never infer a completed challenge, verification, or settlement from a submitted request. Expose asynchronous status and failure reasons.
- Migrate any future persistence separately with an explicit data and recovery plan; this Phase 1 repository contains no database migration.
