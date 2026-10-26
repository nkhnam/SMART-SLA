# Changelog

## [Unreleased]

### Added
- Add a frontend-only SLA-DEX workspace with agreement, monitoring, dispute, verification, and settings previews backed by deterministic demo data.

### Changed
- Use the supported Webpack builder for production builds and add a production HTTP smoke check; document the unresolved Turbopack worker failure and browser-test limitation.

### Removed
- Remove the legacy NestJS/PostgreSQL backend, Polygon contracts, backend-connected frontend flows, and AISC demo assets from the Phase 1 branch.

### Security
- Upgrade Next.js and its matching ESLint config to 16.4.3 and refresh the lockfile to clear reported dependency vulnerabilities.
