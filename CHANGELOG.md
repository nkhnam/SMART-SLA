# Changelog

## [Unreleased]

### Added
- Add a frontend-only SLA-DEX workspace with agreement, monitoring, dispute, verification, and settings previews backed by deterministic demo data.
- Add an authenticated NestJS API, PostgreSQL persistence, immutable draft agreement versions, and a separate live workspace for agreement editing.
- Add an isolated PostgreSQL integration test setup and a CI workflow for backend and frontend validation.

### Changed
- Use the supported Webpack builder for production builds and add a production HTTP smoke check; document the unresolved Turbopack worker failure and browser-test limitation.
- Preserve all Phase 1 demo routes and fixture behavior while linking them to the opt-in live workspace.

### Removed
- Remove the legacy NestJS/PostgreSQL backend, Polygon contracts, backend-connected frontend flows, and AISC demo assets from the Phase 1 branch.

### Security
- Upgrade Next.js and its matching ESLint config to 16.4.3 and refresh the lockfile to clear reported dependency vulnerabilities.
- Enforce server-checked membership scope, opaque HttpOnly sessions, CSRF origin checks, role-gated writes, and production HTTPS CORS origins.
