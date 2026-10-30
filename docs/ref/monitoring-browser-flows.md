# Authenticated monitoring browser flows

Gate 3C exercises the production Next.js build in Chromium against real sessions, PostgreSQL and a local EVM. Agreement setup uses authenticated APIs, signer ownership challenges, bilateral EIP-712 signatures and the existing agreement relayer. Monitoring actions use the browser; no signed status, observation or source is inserted directly into the database.

## Reproduce

Install the locked backend, contracts and frontend dependencies and Playwright Chromium, then run from `backend/`:

````powershell
npm run test:monitoring-browser -- --output <absolute-artifact-directory>
````

The existing acceptance runner creates an ephemeral PostgreSQL container unless `TEST_DATABASE_URL` points at a local `_test` database with `CREATEDB` permission. It creates a fresh database and local EVM, deploys both registries, starts the API and production frontend on allocated loopback ports, runs four browser cases with one worker and zero retries, then stops its processes and drops the database/container in `finally`. A generated encryption key exists only in the test environment. No Fuji credentials or network are used.

Three test accounts are registered once per Playwright worker to respect the existing eight-per-minute registration throttle. Each case creates separate agreements and fresh browser contexts; the customer signs in again through the UI. Provider and unrelated-party contexts inherit only their own test session state. The role case changes exactly one test-created membership through a parameterized PostgreSQL update guarded by a loopback `_test` URL, then restores OWNER in `finally`; runtime authorization remains active for every API request.

## Coverage and expected states

| Case | Expected behavior |
| --- | --- |
| Owner lifecycle | Create a signed webhook, show its secret once, persist pause/resume over reload, rotate the secret, reject the old secret and accept the new HMAC report; never return stored secrets in source lists. |
| Measurement and evidence | Display the persisted report as `PROVIDER_REPORTED` and `VALID`; evaluate sparse data as `INSUFFICIENT_DATA` with unknown uptime and no breach candidate; build and download an integrity-verified package containing the observation. |
| Session boundary | Signing out revokes authenticated source reads; anonymous monitoring renders the sign-in state without the prior source. |
| Responsive isolation | At 375, 768 and 1440 pixels, source controls and the one-time notice fit the viewport; agreement switching clears the previous source and secret, and switching back reloads persisted sources without revealing the secret again. |
| Role and organization boundary | OWNER/ADMIN manage their organization's source; MEMBER cannot create or update; an accepted counterparty can read but cannot manage another organization's source; an unrelated organization cannot read or create. Resume preserves the 20-active-source quota, including concurrent Create/Resume and repeated enable of an already enabled source. |
| SSRF and version boundary | A loopback endpoint returns 400 and creates no source; an unsigned amendment removes the prior agreement from active monitoring and rejects source operations, while historical observations retain version 1. |

The browser's data-loading transition is selected organization → confirmed agreement → loading → sources/observations/evaluations/breaches, or a visible error. Changing the organization/agreement unmounts the previous request owner, so late responses cannot replace current data. Source mutations follow request → persisted update → reload; a pause now persists `enabled=false` together with its existing schedule update. Resume retains the source-creation sampling grid and skips historical slots. No scheduling policy or worker/publisher recovery state is changed here.

The API supplies `canManage` from source ownership and the authenticated membership role. It controls display only; the existing server guards and organization-scoped update query remain authoritative. Resume takes the same organization advisory lock as Create and counts other active sources, so concurrent admission cannot exceed 20 and an idempotent enable remains valid at the limit. Explicit null is rejected for `enabled`. Endpoint validation uses the existing SSRF validator and maps its input rejection to 400 at the source-service boundary. Observation pagination explicitly converts query strings to numbers before existing integer/range validation. Confirmation polling uses bounded backoff rather than saturating the existing API rate limit; its deadline is unchanged.

## Diagnostics and limits

`frontend-build.log`, `browser.log`, `api.log` and `evm.log` identify build, browser, API and signing failures. Failed browser cases retain Playwright screenshots, traces and error snapshots; they can contain disposable test-session cookies and generated webhook secrets, so treat them as test credentials rather than publishable evidence. The database and encryption key are destroyed after the run. Responsive success screenshots mask status notices. Never point this suite at production or use real accounts, signer keys or webhook secrets.

CI runs these cases before the inherited expired-signature regression because that test advances the local EVM clock eight days. The inherited late-response isolation and responsive empty-state cases still run separately. Gates 2, 3A and 3B retain their existing isolated PostgreSQL/local-EVM commands.

This covers authenticated source management with synthetic provider reports. It does not measure a real public HTTP endpoint or establish measurement truth, full Phase 2C acceptance or production readiness.

## Verification record

Baseline `716b76d`: real browser runs reproduced observation pagination returning 400, loopback source validation returning 500, Pause returning `enabled=true`, and horizontal overflow at 375 pixels. The initial per-case account fixture also reached the registration throttle; account reuse within a worker fixes fixture volume without changing runtime limits. Final verification results and hosted CI are recorded with the feature-branch commit report.
