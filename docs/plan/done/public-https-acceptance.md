# Public HTTPS monitoring acceptance plan

Goal: prove real public HTTPS collection through the default HTTP_PROBE worker, with isolated PostgreSQL, existing evidence services and local-EVM verification; commit/push only the feature branch.

## UNDERSTAND

- Baseline: `5a03b56`; Gate 2 signs and anchors real agreements but supplies synthetic webhooks. Gates 3A/3B inject controlled collection/RPC faults; Gate 3C exercises authenticated browser management. None measures a public HTTPS endpoint.
- Preserve the existing source API, DNS pinning/public-address checks, redirect validation, time/body/header limits, roles, CSRF, signing and immutable version boundaries. No schema or deployment change.
- No staging configuration was found in repository docs or environment variable names. Default to a small third-party HTTPS endpoint, with explicit staging URL overrides. Assume no paid API or credential-bearing URL.

## REASON → DECIDE

Goal chain: collect an actual public response → persist attributable observations → verify export/commitment integrity → establish the narrow acceptance fact without claiming measurement truth or production readiness.

Reuse the existing isolated runner and authenticated signing setup, adding one opt-in live mode and a separate live scenario module. A separate end-to-end harness would isolate naming more strongly but duplicate PostgreSQL/EVM/signing orchestration. A local injected transport is deterministic but cannot prove public HTTPS. The live mode must stay outside default CI and fail nonzero if no healthy response was measured.

Use real timestamps and a one-minute source interval. Collect once, leave the next scheduled slot uncollected, then evaluate a signed one-hour window ending now. The engine counts only slots since source creation: this is a bootstrap coverage check, not an hour of monitoring. Missing slots must stay unknown, with null uptime and INSUFFICIENT_DATA. No source timestamp, observation or scheduled run is inserted/rewritten by the scenario.

Critique: a public endpoint can fail because of the observer network; export that failure without declaring a global outage. Guaranteed false success would come from replacing the transport or accepting DNS failure as healthy; neither is permitted. Future endpoint response changes may invalidate the default URL; retain categorized diagnostics and accept operator-selected staging URLs. Existing test-environment trust remains SYNTHETIC_TEST even for real transport; explicitly distinguish real collection from independent measurement.

Risk sizing: reach is the explicitly invoked local test operator (estimated); capability is command execution (observed requirement); motive is acceptance evidence rather than money; blast radius is isolated test records and a few public GETs (estimated). Keep controls at the existing production trust boundaries. Reopen if credentials, private targets, paid endpoints or shared deployment state are required.

## IMPLEMENT → VERIFY

- [x] Add deterministic HTTP-probe regressions for pinned DNS/TLS host identity, redirects, failure categories, size and timeout behavior; demonstrate assertion sensitivity. The `all: true` case failed before the validated-list callback repair.
- [x] Add `test:public-https` to the existing runner, requiring explicit mode and producing diagnostics/evidence on failure as well as success.
- [x] Reuse authenticated bilateral signing; create sources via API, collect with the default worker, assert PostgreSQL runs/provenance, sparse KPI semantics and version isolation.
- [x] Export through existing evidence APIs, publish to local EVM, compare all commitment fields independently and invoke the standalone verifier on original/tampered files.
- [x] Run the live scenario, backend checks and Gates 2/3A/3B/3C. Gate 2: 7/7 twice; 3A: 24/24 twice; 3B: 49/49 twice; 3C: 4/4 after explicit Chromium setup; 3D: real 200/404, 50% coverage, missing slot unknown, no outage claim. Unit suite: 44/44; contracts: 11/11. No skips/cancellations in passing runs. Lint, typecheck, build, documentation-link and format/changelog checks passed.
- [x] Correct README/related acceptance references and record exact commands, observed outcomes, limitations and Fuji prerequisites in the [acceptance reference](../../ref/public-https-acceptance.md).

Delivery verification: inspect hosted Actions for the exact feature commit after push and report its final verdict separately; the external-network scenario remains opt-in and is not silently added to CI.

## TEACH BACK

Report the measured HTTP states separately from observer-network errors, missing collection, synthetic regression inputs and cryptographic verification. A real GET is operator-collected transport evidence; it does not establish a service-wide outage or an independent oracle. Fuji remains undeployed and requires separate approval, funding, dedicated roles/keys, trusted RPC, registry verification and operational configuration.
