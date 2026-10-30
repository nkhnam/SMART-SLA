# Real public HTTPS monitoring acceptance — Gate 3D

This opt-in scenario collects real HTTPS responses through the application's default `HTTP_PROBE` provider and leased worker. It uses authenticated source APIs, real PostgreSQL, bilateral signing, existing KPI/evidence services and both local EVM registries. External network availability is required; this command is deliberately absent from deterministic CI and the default integration suite.

## Reproduce

Requirements: Node matching the backend manifest, locked backend/contracts dependencies, and Docker's Linux engine. From the repository root in PowerShell:

````powershell
npm ci --prefix backend
npm ci --prefix contracts
cd backend
$artifacts = Join-Path $env:TEMP "sladex-gate3d"
npm run test:public-https -- --output $artifacts
````

From `backend/` on POSIX, use `npm run test:public-https -- --output "${TMPDIR:-/tmp}/sladex-gate3d"`. Each invocation creates a fresh `phase2c-*` artifact directory, `_test` database and private Hardhat chain. The existing runner can instead use `TEST_DATABASE_URL` for a loopback PostgreSQL `_test` database whose user can create/drop sibling databases; it never resets the supplied database. No Fuji RPC, funding or public chain transaction is involved.

The default targets are `https://example.com/` and `https://example.com/sladex-gate3d-missing`. They are third-party public endpoints, not SLA-DEX-controlled staging. The second URL requests a missing resource; it does not interrupt the service. A controlled staging endpoint is preferable when available. To use one, set `LIVE_HTTPS_URL` to its public HTTPS healthy URL and optionally `LIVE_HTTPS_FAILURE_URL` to a public route that intentionally returns an HTTP error, then run the same command. Setting only a custom healthy URL omits the HTTP-failure case and reports `NOT_REQUESTED`; it does not silently reuse example.com. Do not supply credentials, query strings, sensitive paths, paid APIs or private addresses. The scenario requires HTTPS, and the production validator still enforces standard ports and public addresses.

## What is exercised

1. Reuse Gate 2's real session, organization invitation, signer challenges, bilateral EIP-712 signatures and confirmed agreement anchor. Create HTTP sources through authenticated APIs. Anonymous creation and counterparty source changes must be rejected.
2. Stop worker timers through existing lifecycle methods and invoke the real worker once. No HTTP provider override, injected response, DNS replacement, observation insert, schedule rewrite or clock mock is used. DNS is separately diagnosed using the production resolver; that diagnostic is an earlier lookup, not a packet trace of the worker's later lookup.
3. Assert one persisted observation per source and its completed run, version, collection method, trust category and discarded-response-body metadata. The worker continues to resolve and pin a validated public address for every request and redirect, retain the original TLS hostname/certificate verification, reject HTTPS downgrades, use a 5-second socket timeout, 16 KiB header limit, 64 KiB body limit and three-redirect cap.
4. Wait on the real clock until the next one-minute slot is due, deliberately leaving that slot uncollected. Evaluate the exact signed one-hour window ending now. The sample grid starts at source creation: normally two expected slots, one valid observation, one unknown, 50% coverage, null uptime and `INSUFFICIENT_DATA`, with no breach candidate. This is bootstrap coverage over newly created sources, not an hour of continuous monitoring. Longer scheduling delays may produce additional unknown slots.
5. Build/export through the existing evidence APIs, publish using the separately authorized evidence worker, and compare every commitment field, publisher, receipt and block timestamp with an independent local EVM client. Run the existing standalone verifier in a separate process: original export exits 0; one copied observation with flipped reachability exits 1. Verify the original export survives amendment unchanged.
6. Amend to unsigned version 2. The old provider loses current-version access (`404`), owner monitoring writes are rejected (`409`), the worker disables due inactive-version sources and no version-2 observation appears. Historical version-1 evidence remains exportable by the owner.

## States and provenance

| Result | Meaning | Does not establish |
| --- | --- | --- |
| `OBSERVED_HEALTHY` | A real validated HTTPS request returned an accepted status from this observer. | Long-term uptime, global availability or truthful endpoint content. |
| `HTTP_FAILURE` | A real HTTP error response was received; the default negative route normally returns 404. | A service-wide outage. |
| `UNAVAILABLE_FROM_OBSERVER` | DNS, connection, TLS, timeout, invalid/oversized response or another collection limitation prevented an acceptable response. Inspect `errorCategory`, validity and DNS diagnostics. | Whether the service or the observer's DNS/network caused the failure. |
| `MISSING` / unknown KPI slot | No corresponding observation was collected. The deliberate second slot demonstrates this without inserting downtime. | Healthy or failed service state. |
| `outage: NOT_ESTABLISHED` | No independently corroborated outage was measured or induced. | An outage/recovery demonstration. |

The test environment retains the production API's `SYNTHETIC_TEST` trust category because `NODE_ENV=test`; this is not rewritten to `OPERATOR_COLLECTED` or `INDEPENDENT`. `realNetwork: true` and `syntheticObservations: false` describe actual transport collection, while `independentMeasurement: false` states its trust limit. Gate 2's webhook outage reports and Gate 3A's injected probe results remain synthetic. Deterministic HTTP-probe regressions mock DNS/transport and prove callback, pinning, redirect and limit behavior, not Internet connectivity.

The existing KPI policy counts valid transport reachability failures, including DNS failures, as failed observations from that observer; invalid/oversized responses are invalid and remain unknown. Inspect their error categories before interpreting a KPI. The acceptance's missing-slot check prevents a low-coverage success and never treats a network error as proof of global downtime.

## Artifacts, failure and cleanup

`run-1/network-observations.json` contains real source/run/observation data and categorized DNS diagnostics. `evidence.json`, `evidence-tampered.json`, separate verifier verdicts and `summary.json` record coverage and chain verification. Summary acceptance requires an observed healthy response and, when requested, an actual HTTP-failure reply. Missing DNS/network access must exit nonzero after retaining available real observations and evidence; it cannot become a skip or green result. Invalid source setup or later database/EVM failures may stop before export; inspect `failure.json`, `test.log`, `migrations.log`, `evm.log` and build/PostgreSQL logs. A test assertion failure remains a failure even if some observations succeeded.

Observations are persisted in real PostgreSQL during the run. Cleanup drops only that invocation's generated database, stops owned processes/container and removes its isolated runtime home; retained exports are the durable evidence after database cleanup. Artifacts contain no private keys, sessions or webhook secrets. Local EVM addresses/hashes are local evidence only. Remove the printed artifact directory when it is no longer needed.

## Other gates and Fuji prerequisites

After installing frontend dependencies and Chromium (`npm ci --prefix frontend`, then `npx playwright install chromium` from `frontend/`), rerun from `backend/` with an absolute artifact root:

````powershell
npm run test:phase2c-acceptance -- --output $artifacts
npm run test:monitoring-reliability -- --output $artifacts
npm run test:evidence-reliability -- --output $artifacts
npm run test:monitoring-browser -- --output $artifacts
````

Gates 2/3A/3B run twice against fresh environments; Gate 3C runs four authenticated Chromium cases with no retries. Hosted CI additionally runs inherited signing/browser regressions, responsive cases, integration/migration tests, static checks, builds, contract tests and dependency audits. Inspect the Actions run for the exact pushed feature commit. A hosted green run does not run Gate 3D or guarantee the observer's external network.

The local harness isolates HOME/LOCALAPPDATA. When Chromium was installed into the usual user cache, set `PLAYWRIGHT_BROWSERS_PATH` to that installation before the Gate 3C runner (on Windows, `$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA "ms-playwright"`). This selects installed browser binaries while keeping test profile/temp data isolated. The hosted workflow invokes Playwright directly after installation and does not need this local-harness override.

Fuji remains a separate explicitly approved deployment. Required: a trusted chain-43113 RPC; funded dedicated testnet deployment/relayer/publisher wallets; distinct agreement and evidence relayers; explicit EvidenceRegistry publisher/owner control; securely supplied backend RPC/registry/key/confirmation configuration; real PostgreSQL migrations and operational monitoring; production encryption/session/HTTPS-origin configuration; independent bytecode, receipt, publisher and full commitment read-back; and actual two-party wallet approval of the signed version. See [Fuji deployment](../deployment/fuji.md) and [EvidenceRegistry deployment](../deployment/evidence-registry.md). This gate neither deploys Fuji nor establishes production readiness.

## Observed local result

On 2026-10-30, Node 26.8.2 on Windows completed the real-network run with zero failures or skips. `example.com/` returned 200 and the requested missing route returned 404. Each source persisted one real HTTP_PROBE observation and completed run. Each evaluation had 2 expected slots, 1 unknown, 50% coverage, null uptime and `INSUFFICIENT_DATA`; the healthy source counted 1 healthy/0 failed and the missing-route source counted 0 healthy/1 failed. No breach candidate or real outage was asserted. Version isolation passed after amendment.

The existing evidence publisher confirmed the real export on chain 31337; an independent client compared every commitment field and receipt/block timestamp. The standalone verifier exited 0 for the original and 1 for the mutated copy. The local evidence transaction was `0x4fc51baca2524406d79b07465e4507837efccb995423743d33d01ebae03e3e4f`, with Merkle root `0x22e1a868453654725cf7906220b420577107af4aa4320039d3a15b2c89b7ec9a` and batch digest `0x08f1e17884ee00901f4398cff7779cce07faa8f5d227f9b40643116a94f14030`. The disposable chain/database were removed after export; these hashes are not Fuji or explorer references. Retain the invocation's `summary.json`, original export and verifier verdicts to inspect that run.

The first live attempt exposed `ERR_INVALID_IP_ADDRESS` in Node's request lookup: the callback returned a string when Node requested all addresses. A deterministic `all: true` regression failed before the one-element validated-list repair and passed afterward. The first post-repair transport received 200/404 but failed on a stale amendment-status expectation; that attempt is not counted as a passing acceptance run. The final run used corrected authorization assertions and exact per-source KPI counts. The full backend unit suite passed 44 tests with zero skips; lint, typecheck and focused acceptance TypeScript checks passed. Injected transport regressions and earlier failed attempts remain separate from the successful real-network evidence.

Gate 2 passed 7 tests in each of two fresh PostgreSQL/EVM runs, Gate 3A passed 24 in each of two PostgreSQL runs, and Gate 3B passed 49 in each of two PostgreSQL/EVM runs, all with zero failures, cancellations or skips. Gate 3C's first local attempt failed before browser execution because Chromium was absent from the harness's isolated cache; that is an environment/setup failure, not browser coverage. After installing Chromium into a task-local directory and setting `PLAYWRIGHT_BROWSERS_PATH`, all 4 Gate 3C browser cases passed with zero retries. The separate local contract suite passed 11 tests. An explicit browser installation path is required as described above; the task-local browser binaries are removed after use.
