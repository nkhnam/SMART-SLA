# Gate 4A Fuji deployment preflight audit

Status: amended 2026-10-31. The baseline findings below are historical; Gate 4A.1 implements the confirmation correction described in the closing amendment.

## Start time

2026-10-31, Asia/Saigon. Baseline `8d6e4f5` on `feat/unihack-phase2c-oracle-evidence`; initially clean working tree.

## Initial purpose

Determine whether SLA-DEX can be deployed securely and reproducibly on Avalanche Fuji without sending transactions. Inspect contracts/config/scripts, both backend relayers, deployment documentation and existing Gate 2/3 results. Only preflight improvements may be committed/pushed to the feature branch.

## Strategy

Read the deployment-to-runtime flow, separate local evidence from live network evidence, compare compiler settings with official Avalanche documentation, inspect authorization/secret boundaries, then implement narrowly scoped deployment admission and read-only diagnostics. Keep audit findings separate from the subsequent fixes.

## Checklist

- [x] Inspect Hardhat config and both deployment entry points.
- [x] Inspect AgreementRegistry and EvidenceRegistry plus existing contract tests.
- [x] Inspect backend environment validation, agreement relayer, evidence publisher and frontend environment references.
- [x] Read Gate 2 and Gate 3 acceptance records and existing CI workflow.
- [x] Record current-run RPC, gas, artifact and local-check results below.

## Result

Initial verdict: **NO-GO for Fuji execution**. Local readiness and deployment authorization are separate gates.

| Severity | Finding at baseline | Handling |
| --- | --- | --- |
| High | `contracts/scripts/deploy.ts` deploys before reading the actual chain ID; `deploy-evidence.ts` requires a Fuji publisher but does not reject other live chains. Hardhat config specifies 43113 but the scripts lack an independent admission boundary. | Add pre-broadcast allowlist/chain/role/approval checks to both scripts; verify refusal cases without live transactions. |
| High | `BLOCKCHAIN_CONFIRMATIONS` is validated and has an accessor but no agreement worker/API call uses it. Existing record reconciliation and successful/reverted receipt paths can finalize without configured depth/canonical-receipt checks. | Deployment blocker: reconcile policy or explicitly approve Fuji accepted-state semantics at one confirmation in a separately scoped task; do not claim configuration enforces depth. |
| High | Role addresses/custody, live funding estimates, actual registry identities and deployment receipts have not been supplied or verified. | Keyless role/balance/gas preflight and a separate execution approval; all address/receipt fields remain placeholders. |
| Medium | Existing runbook suggests checking chain ID after deployment and says an ignored `.env` supplies Hardhat variables, although the config does not load dotenv. Evidence local instructions confuse an ephemeral simulated deployment with a persistent node. | Replace with exact process-environment commands, safe read-only preparation and correct `--network localEvm` guidance. |
| Medium | Backend checks contract presence and agreement EIP-712 domain; evidence checks presence/publisher. Neither pins exact deployed runtime bytecode. | Require independent artifact/source verification before enabling workers; add post-deployment read-only identity checks. |

AgreementRegistry is permissionless: any sender may relay two valid EOA signatures. Backend organization/signer authorization is essential; the contract only verifies addresses named in the approval, not real organization membership. It stores organization hashes, agreement hash/version/expiry/timestamp; signer addresses/signatures are visible in transaction calldata, not retained as stored signer fields. EvidenceRegistry has a deployer owner and one rotatable publisher, no ownership-transfer function, no proxy, no pause/delete/rollback and no on-chain AgreementRegistry linkage. Evidence authorization does not certify measurement truth.

Evidence publication validates persisted signed bytes, exact calldata/domain/value, reporter identity, canonical receipt block and confirmation depth using a fixed head, and separates current publisher authorization from historical reporter identity. Both workers start automatically once their required environment is supplied; do not start the backend with live keys during preflight. Preserve PostgreSQL outbox/nonce/lease state and encrypted webhook-key custody.

### Existing acceptance evidence

The [Gate 3D record](../ref/public-https-acceptance.md#observed-local-result) at this baseline reports Gate 2 7/7 twice, Gate 3A 24/24 twice, Gate 3B 49/49 twice, Gate 3C 4/4 after Chromium setup, backend units 44/44 and contracts 11/11, with no skips/cancellations in the passing runs. Earlier [Gate 3B attempts](../ref/evidence-publisher-reliability.md) had timeouts/cancellations and are not passes. Gate 3D recorded actual HTTPS 200/404, sparse 50% coverage, unknown missing slot and local-chain evidence verification/tamper rejection. These are historical records, not current-run verification, Fuji receipts, independent measurement truth or production readiness. Exact-commit hosted CI must be checked separately.

### Verification

- Official [network parameters](https://build.avax.network/docs/primary-network) and [Hardhat compatibility guide](https://docs.avax.network/docs/primary-network/verify-contract/hardhat), read 2026-10-31: Fuji C-Chain ID 43113 (`0xa869`), public RPC `https://api.avax-test.network/ext/bc/C/rpc`; explicitly target Cancun. Existing compiler is lockfile-pinned solc 0.8.38 with optimizer 200 and Cancun.
- Official [C-Chain RPC](https://docs.avax.network/docs/rpcs/c-chain) and [exchange integration/finality](https://build.avax.network/docs/primary-network/exchange-integration), read 2026-10-31: accepted blocks are final, while receipt/state availability follows execution. Evidence confirmation depth is an application policy, not additional Avalanche consensus finality. A missing receipt remains uncertain.
- Initial sandbox GitHub access failed DNS; authorized access reached the feature remote at baseline. Authenticated read-only Actions lookup confirmed [baseline run 41078413130](https://github.com/nkhnam/Shadow-Byte/actions/runs/41078413130) succeeded for full SHA `8d6e4f53ed59f58595a1408e139997c09d027f1c`. This is baseline CI, not the preflight improvement commit.

### Current-run checks (2026-10-31)

| Check | Actual result | Scope / limitation |
| --- | --- | --- |
| Runtime | Node 26.8.2, npm 12.2.1 on Windows | Hosted workflow uses Node 24; exact-commit CI remains required. |
| Keyless `npm run preflight:fuji` | Exit 1, `NO_GO`, `readOnly: true`, `deploymentAuthorized: false` | Correct refusal: real role set absent. No signature/broadcast. |
| Live RPC | 43113; block 60284644, hash `0x3393a833ffc83bd003d260973c119ff51c3d4efb47411cdab025334f2dc6fd57`; gas limit 32000000; gas price 160 wei; observed `2026-10-31T02:16:22.283Z` | Read-only official RPC sample; values expire. No second provider, real role balances/nonces, constructor gas estimate or deployed address/receipt available. |
| Compiler/artifacts | Compile exit 0; solc 0.8.38, Cancun, optimizer 200 accepted. Agreement init/runtime 4540/3625 bytes; evidence 1938/1752 bytes | Source/lockfile retained; agreement runtime template includes immutable slots and is not an on-chain hash. |
| Policy regression | Two refusal assertions failed (`Missing expected exception`), then passed after boundary implementation | Initial standalone Node attempt failed import resolution, not behavior; actual red came from Hardhat's existing node:test runner. |
| Contract suite | `npm test`: 17/17, exit 0, zero skips/cancellations | Original 11 registry cases plus 6 deployment/identity/bytecode policy cases; local EVM only. |
| Scripts/local deployment | Typecheck and both local deployment commands exit 0 | Existing chain-31337 CI JSON retained. Ephemeral chains each return their own first deployment address, not a shared/Fuji deployment. |
| Dependency repair | `npm ci --ignore-scripts --no-audit --no-fund`: exit 0, 146 locked packages | Installed viem lacked declared `_types/index.d.ts`; restored unchanged lockfile before trusting typecheck. No version change. |
| Backend | lint, typecheck, 44/44 units (zero skips/cancellations), build and anchor-integration typecheck: exit 0 | Build initially failed missing `DATABASE_URL`, then passed with a nonsecret local test URL; generation/build did not connect to a database. Node 26 emitted loader deprecation warnings. |
| Frontend | API/wallet/comparison suite 7/7, lint and TypeScript: exit 0 | Zero skips/cancellations; existing module-format warnings on Node 26. Frontend source unchanged. Production build/smoke and browser flows are left to exact-commit CI. |
| Dependency audits | Contracts: zero vulnerabilities, exit 0. Backend high-severity threshold: exit 0, 11 moderate advisories in ESLint/minimatch dependency paths | Existing lockfiles unchanged. No forced dependency downgrade/upgrade in preflight; moderate tooling risks remain recorded rather than described as a clean audit. |
| Backend production dependency audit | `npm audit --omit=dev --audit-level=high`: exit 0, zero vulnerabilities | Distinguishes the reported tooling advisories from the production dependency set at this observation time. |
| Gate 2 rerun | Exit 1 at PostgreSQL setup; no acceptance test executed | Docker daemon unavailable; no configured guarded local DB/service. Gates 3A/3B/3C and integration/upgrade share this unavailable prerequisite and were not claimed as passes. Failed setup created no database/EVM/backend. The runner attempted cleanup after the Docker daemon request failed; no container was created by that request. |
| Secrets/frontend | 195 tracked/new text files scanned; zero unclassified key-like literals in key contexts, private-key blocks or frontend secret-env references; 3 known public Hardhat fixture occurrences | Static pattern scan, not proof about history/external secret stores. No real secret printed and no public fixture funded. |
| Docs/format | Local Markdown links, diff whitespace, scoped scythe and latest changelog lint exit 0 | No version minted; Solidity/schema/runtime relayer code unchanged. |
| Independent review | Two P2 findings corrected: post-deployment checks no longer require a new deployment budget; execution block now stops on each failed command and removes approval/key in `finally` | Read-only review; no additional live transaction or deployment. |

Final post-review preflight returned the same intended refusal at `2026-10-31T02:19:39.6Z`, block 60284734, chain 43113 and gas price 160 wei, with `phase: PRE_DEPLOYMENT_PLANNING`. Post-deployment identity and actual role-budget branches remain unverified against Fuji because real roles/registries were not supplied; they were typechecked and reviewed, not represented as live passes.

### Pre-commit delivery gate

| Step | Verdict / evidence |
| --- | --- |
| S0 — tree | PASS: initially clean at 8d6e4f5; only task-owned preflight/code/docs/CI files changed. |
| S1 — release state | PASS: manifests remain 0.1.0; existing `[Unreleased]` receives preflight entries. No release invoked. |
| S2 — hygiene | PASS: scoped scythe, diff whitespace and static secret/frontend scan described above; independent review findings closed. |
| S3 — persistence/external actions | N/A to execution: no Solidity, backend runtime or Prisma changes; detector over tracked code/config additions returned empty, and new scripts contain no schema writes. No database migration, funding, public deploy or public registry write performed. |
| S4 — record | PASS: latest changelog lint exit 0; new entries describe preparation and the unresolved confirmation limitation. |
| S5 — docs | PASS: runbooks, README/index, audit and active blocker plan synchronized; local links resolve. |
| S6 — checks | PASS for changed contract/script surface and available backend/frontend static/unit checks. Database/browser/full-build local parity is incomplete due unavailable PostgreSQL; exact-commit hosted CI is required before any Fuji GO. This branch delivery is a preflight improvement, not a release authorization. |
| S7 — honesty | PASS: absent real roles/gas estimates/registries/receipts, local Gate 2 setup failure and live branches not exercised are explicit. |
| S8 — version | N/A: feature-branch preflight only; no version/tag/release minted. |

Self-interrogation: the easiest check to skip was deployment entry-point compatibility; both scripts were actually executed on ephemeral chain 31337 and their original JSON verified. No production data path was exercised or claimed: no backend public deployment occurred. The diff changes no persisted application data/schema, so previous-schema migration rehearsal is inapplicable. The material unchecked deployment risks are real custody/funding/domain identities and agreement confirmation policy, all retained as NO-GO checklist items rather than absorbed by local test passes. A future production incident cannot be ruled out by this preparation.

Agreement creation bytecode hash: `0x9ba0a96a13a008c5b28f5117b822ac1b0c2efc13eabd6ced1778e3fb7505f50e`; runtime template: `0xcb8701af9599a0d92b09e224e15887fd14306823f94d6e54eae87ad7e87a35ac`. Evidence creation bytecode hash: `0x5ce7216a4141f7ea45dbfab358dd6fc3df510a5f892c46d9dded231b76ae5239`; runtime template: `0x8426365538b60a43dfbd557abf64ec4ad9a2b0c824d6eae81a2e39466ca237e1`. These fingerprint local artifacts, not Fuji deployments.

## Decision

**Action:** implement the [preflight plan](../plan/fuji-preflight.md) and use [the deployment runbook](../deployment/fuji.md) as the operational checklist. Keep Solidity/authorization/storage design and runtime relayer recovery unchanged. Rejected docs-only safety because it leaves the broadcast boundary unsafe; rejected a contract/relayer redesign because it broadens this gate. Attack on the selected approach: a script guard cannot authenticate a malicious RPC, so independent RPC/explorer verification and role custody remain mandatory. Failure inversion/pre-mortem: reused keys, stale artifacts, auto-started workers or an ambiguous retry could create irreversible writes despite a green local test. Second-order effect: stricter admission must preserve local CI output and leave Fuji activation an explicit separate operation. Reopen if new deployment entry points, changed compiler settings or a changed confirmation policy appear. Commercial positioning/pricing analysis is outside this operational gate.

## Amendments

- 2026-10-31 · Agreement confirmation finding: a separately authorized Gate 4A.1 implements the [shared confirmation evaluator and worker/API ownership policy](../ref/agreement-confirmation.md), preserving contracts, EIP-712 and database schema. The preflight baseline finding remains reproduced historical evidence, not current runtime behavior. The [execution record](../plan/agreement-confirmation.md) records RED and verification scope; exact-final-commit hosted CI and real N=3 integration evidence are required to close N1. Fuji custody/funding and separate deployment approval remain N2/N3 blockers; no public-chain transaction is authorized by this correction.
