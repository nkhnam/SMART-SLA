# Local contest-readiness validation — 11 November 2026

Application repairs were committed as `f9b9ffd`; validation diagnostics and CI coverage were added in `0f1004b`. Checks ran directly in `D:/code/Shadow-Byte` on Node.js 26.8.2 and npm 12.2.1, using the existing installed dependencies. The subsequent documentation and loopback-only Compose changes do not change application or contract runtime code.

## Results

| Area | Check | Observed result |
| --- | --- | --- |
| Frontend | `npm run build` | Passed production Webpack build, TypeScript and generation of all 16 static pages; dynamic agreement routes built successfully. |
| Frontend API | `npm run test:api` | 9 passed, 0 failed. Includes page selection and monitoring discovery beyond 50 agreements. |
| Production HTTP | `npm run test:production-smoke` | 12 route checks passed, including expected content, demo labels, internal links and disabled preview actions. |
| Browser | `workspace-review.spec.ts`, one worker, no retries | 5 passed. API responses are mocked. Organization ID copying, shared terms, confirmed snapshots, pagination and monitoring discovery were exercised. |
| Responsive UI | Browser cases at 375, 768 and 1440 pixels | Passed; screenshots at 375 and 1440 pixels were also visually inspected. No layout repair was needed after inspection. |
| Frontend lint | ESLint on all 10 changed TypeScript/TSX/MJS files, with a 1 GiB heap limit | Passed. The earlier whole-frontend lint run was stopped under host memory pressure; it is not reported as a completed check. |
| Backend | `npm run build`, `npm run lint` | Passed. Prisma Client 7.10.1 generated successfully. |
| Backend unit | The declared `test:unit` file list with `--test-concurrency=1` | 118 passed, 0 failed, 0 skipped. |
| PostgreSQL API | `npm run test:integration` | 5 passed, 0 failed, 0 skipped, after applying all four migrations to the isolated test database. |
| Contracts | `npm run compile`, `npm run typecheck`, `npm test` | Passed; 26 contract/deployment-policy cases passed. |
| Local deploy script | `npm run deploy:local` with a public fixture publisher different from the deployer | Passed constructor wiring and owner/publisher read-back; retained the existing local JSON address format. |
| Anchor recovery | Existing `anchor-recovery.integration.test.ts` with an owned loopback EVM and a unique sibling test database | 27 passed, 0 failed, 0 skipped. Includes the rejected outsider front-run and successful owned registration with confirmation-depth checks. |
| Full Phase 2C | `npm run test:phase2c-acceptance` | Two fresh PostgreSQL/EVM runs passed. Both verified bilateral signing, persisted KPI/breach/evidence data, agreement and evidence anchoring, version isolation and standalone tamper rejection. |
| Compose | Parsed `docker compose --profile test config --format json` and asserted published host addresses | Both local database services bind to `127.0.0.1` on ports 5432/5433. |

The full-stack outage is explicitly synthetic and provider-reported. Each run used 12 expected observations: 8 healthy, 4 failed, 0 unknown, 100% coverage and 66.67% uptime. Original evidence passed the standalone verifier; altered evidence failed it. These are integrity and workflow checks, rather than proof of an independently measured real outage.

The anchor runner's cleanup record confirms its own EVM was stopped, its unique database was dropped, and no cleanup errors remained. The session-owned PostgreSQL containers, network and temporary volume were removed after all checks. Test PostgreSQL used ephemeral memory-backed storage; these checks do not establish database crash durability.

## Reproduction evidence and setup incidents

- Before repair, 60 healthy provider reports offset from the exact sampling millisecond produced 0% coverage. Closing-slot normalization produced 100% coverage; duplicate/boundary checks passed. The two new frontend pagination/API regressions were also observed failing before their repair.
- Other service and contract regressions were added around the repairs, but their initial full runner attempts were interrupted under memory pressure. No claim is made that every new regression was observed red before implementation. Final unit, contract and integration checks above passed.
- A temporary checkout on C: reused D: dependencies through junctions. Next generated invalid cross-drive module paths there. Direct execution in the requested D: checkout passed without an application workaround.
- The first production smoke attempt failed before any route check. Its old outer catch hid the precise startup reason. Startup diagnostic logging was added; the next run passed all 12 routes. The original intermittent startup cause remains undetermined.
- The first browser attempt was blocked before UI assertions because Chromium headless shell v1248 was absent. Installing the pinned browser with `npx playwright install chromium --only-shell` resolved that prerequisite; all five cases then passed without retries.
- No fresh `npm ci` completed in this session. Final verification used the existing installed dependency versions. Run the hosted Node 24 workflow for a fresh lockfile-install verdict on the final pushed commit.

## Fuji and submission blockers

Read-only Fuji preflight at **21:54:40 Vietnam time on 11 November 2026**, against chain 43113 at block 60,896,594, returned **`NO_GO`**. The configured deployer and both relayers had 0 test AVAX; the buyer and supplier roles also had zero balances. Fresh artifact fingerprints and constructor-aware gas estimates were obtained for the repaired contracts. These planning estimates must be repeated before approved execution; the separate unsigned preview must produce the complete constructor-inclusive initcode hash.

No private key or deployment approval was supplied and no transaction was signed or broadcast. Predicted addresses are conditional planning values, not deployed registry addresses. No current deployment/ownership claim was established. See the [Fuji runbook](../deployment/fuji.md) for role custody, funding, separate execution admission and post-deployment read-back requirements. A real demo also needs securely provisioned backend database/encryption configuration and distinct relayer credentials; the keyless safe launcher deliberately disables workers.

The anonymous GitHub repository API returned HTTP 404, while authenticated Git fetch succeeded. Public accessibility is therefore not established by these checks. Confirm that judges can access the repository: the [organizer FAQ](https://team1vn.xyz/#faq-submit) permits a public repository or private access for `tuantqse90`.

No branch was pushed and no hosted workflow result is claimed. The workflow now covers `main`, the existing phase branches and this repair branch. Keep the earlier organizer deadline, **23:59 on 21 November 2026 in Vietnam**, and prepare the required slides and 2–3 minute video using the [submission guide](submission-guide.md).

## Scope limits

The authorized publisher closes outsider agreement-key poisoning. The trusted backend still manages organization authorization; the contract does not independently identify organizations. Evidence verification establishes committed record integrity and inclusion. Numerical consistency is checked by the server before new batches, while exact historical evaluation input IDs and portable numerical KPI replay remain unsupported. Disputes, arbitration, escrow and payouts remain outside the implemented product.
