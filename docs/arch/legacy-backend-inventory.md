# Legacy backend inventory

This inventory records the backend and Polygon implementation on archive branch `archive/pre-phase1-foundation` at commit `0b7a2a5`. Phase 1 removes these implementations from the feature branch; it does not claim that they are deployed or production-ready.

## API surface

All routes were provided by NestJS under `/api`. Protected routes used JWT authentication and organization/role checks where implemented.

| Area | Routes | Behavior |
|---|---|---|
| Authentication | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `PUT /auth/me`, `GET /auth/members`, `POST /auth/members` | Register organization and initial user, issue sessions, manage profile and members. |
| SLA contracts | `POST /contracts/create`, `GET /contracts/list`, `GET /contracts/:id`, `PUT /contracts/:id/name`, `PUT /contracts/:id/terms`, `GET /contracts/:id/kpi`, `GET /contracts/:id/report`, `GET /contracts/:id/verify` | Build, list, inspect, revise pre-signature terms, calculate KPI summaries and reports, and compare stored terms with the chain fingerprint. |
| Monitoring | `GET/POST /contracts/:id/oracle`, `DELETE /contracts/:id/oracle/:configId`, `POST /contracts/:id/monitoring`, `GET /contracts/:id/uptime-history`, `POST /webhooks/:contractId`, `GET /dashboard/timeline` | Configure HTTP and webhook sources, ingest measurements, run probes, and present history/timelines. The webhook accepted token query/header fields and a JSON status body. |
| Signing | `GET /contracts/:id/signing`, `POST /contracts/:id/signer`, `POST /contracts/:id/sign`, `POST /contracts/:id/sign-otp/request`, `POST /contracts/:id/sign-otp/verify` | Declare wallets and collect EIP-712 or OTP signatures; activate a contract when both parties sign. |
| Violations and disputes | `GET /violations`, `GET /violations/:id/verify`, `POST /violations/:id/challenge`, `POST /violations/:id/resolve` | Evaluate KPI breaches, preserve evidence hashes, allow challenges in a deadline window, and resolve cases. Settlement was a distinct legacy operation and must not be represented as occurring in Phase 1. |
| Tickets | `GET /negotiation-summary/enabled`, `POST /contracts/:id/negotiation-summary`, `GET/POST /contracts/:id/tickets`, `GET /tickets/:ticketId`, `POST /tickets/:ticketId/messages`, `POST /tickets/:ticketId/status` | Contract negotiation and support conversations, with optional generated summaries. |
| SLA builder | `GET /sla-builder/catalog` | Return the old KPI and template catalog. |
| Marketplace | `GET /listings`, `GET /listings/mine`, `GET /listings/:id`, `POST /listings`, `PUT /listings/:id`, `POST /listings/:id/submit`, `GET /admin/listings`, `POST /admin/listings/:id/approve`, `POST /admin/listings/:id/reject`, `GET /marketplace/providers`, `GET /marketplace/providers/:id`, `PUT /marketplace/profile` | Manage and review provider listings and provider profiles. |
| Notifications | `GET /notifications`, `POST /notifications/read-all`, `POST /notifications/:id/read` | List and mark organization notifications read; legacy notification service could also send email. |
| Billing | `GET /billing/plans`, `GET /billing/me`, `GET /billing/history`, `POST /billing/subscribe` | Apply plan eligibility, quotas, per-contract charges, and payment history. |
| Administration | `GET /admin/users`, `GET /admin/revenue`, `POST /admin/payments/:id/replay`, `GET /admin/source-compare`, `GET/POST /admin/contracts/:id/monitoring`, `GET /system/status` | Platform user/revenue views, payment replay, monitoring source comparisons, and system status. |
| Demo provider | `GET /demo-provider/health`, `GET/POST /demo-provider/state`, `GET /demo-provider/watchers` | Mutable outage/delay endpoint used by the old live-monitoring demo. Removed rather than simulated. |

## Database entities

The Prisma/PostgreSQL schema contained 14 models: `Organization`, `User`, `Provider`, `SlaContract`, `OracleConfig`, `SlaEventLog`, `ViolationCase`, `SlaKpi`, `Notification`, `ContractSignature`, `Ticket`, `TicketMessage`, `ServiceListing`, and `PaymentTransaction`.

`SlaContract` connected client organizations and providers, terms, KPI definitions, monitoring configuration, signatures, logs, violations, and tickets. `ViolationCase` retained target/actual values, evidence hash, challenge deadline/reason, resolution, and separate record/challenge/settlement transaction hashes. Organization/provider/user models held identity, roles, plan state, and membership. Remaining models covered oracle samples, messages, notifications, provider offers, and payment transactions.

## Business logic and chain behavior

- Registration created an organization and an initial member; login applied password verification, failed-attempt counters, and temporary lockout. JWT and role/party checks guarded organization and platform operations.
- Contract construction normalized service terms, KPI thresholds, data sources, exclusions, credit tiers, challenge windows, and optional contract dates/values. Terms could be revised before full signing; signatures were reset when terms changed.
- Oracle jobs probed configured HTTP endpoints on a schedule and ingested custom webhook measurements. KPI aggregation computed uptime, latency, ticket metrics, source comparisons, and violation eligibility.
- Violations stored a hash of evidence and allowed a challenge until the deadline. Admin resolution recorded uphold/dismiss outcomes. Penalty caps and notification logic applied in the legacy service. Contract deployment, signatures, evidence, challenges, and settlement had Polygon transaction paths.
- Billing plans controlled active-contract/source quotas and probe intervals, with plan subscription and per-contract payment logic. Marketplace review, reputation, and listing behavior were separate modules.
- The Solidity implementation is in the archived `contracts/contracts/SLAContract.sol`; Hardhat deployment artifacts are for Polygon Amoy chain ID `80002`.

## Recovery

The complete pre-Phase-1 tree is available by checking out `archive/pre-phase1-foundation`. No database data was copied or modified by Phase 1.
