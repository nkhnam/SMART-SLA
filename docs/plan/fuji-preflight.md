# Gate 4A Fuji preflight implementation plan

**Goal:** Prepare a reproducible Fuji deployment without broadcasting, funding, publicly deploying the backend or merging main.

**Architecture:** Retain Hardhat 3, viem, Solidity Cancun, both existing registries and PostgreSQL relayers. Put deployment admission before wallet access and provide a separate keyless read-only preflight. Separately authorized runtime confirmation work is delivered by Gate 4A.1 below.

**Baseline:** `8d6e4f5`, branch `feat/unihack-phase2c-oracle-evidence`.

**DevFlow:** UNDERSTAND → REASON → DECIDE → IMPLEMENT → VERIFY → TEACH BACK.

## Work sequence

1. [x] UNDERSTAND: inspect both deployment scripts/configuration, contracts, backend relayers/configuration, deployment docs and existing Gate 2/3 records. Record findings in [the preflight audit](../research/fuji-preflight.md) before code changes.
2. [x] REASON/DECIDE: keep bilateral authorization and evidence ownership unchanged; reject docs-only safety because the agreement script checks its chain after broadcast. Reject a relayer/contract rewrite because Gate 4A requests infrastructure reuse. A shared deployment boundary is justified by two scripts controlling irreversible writes. Threat reach is the deployment operator (estimated), capability is running a CLI (observed), motive is an operational mistake (estimated), and blast radius is irreversible network writes/key disclosure. Enforce once before deployment; reopen if another deployment entry is added.
3. [x] IMPLEMENT: add negative deployment-policy tests under `contracts/test/`, demonstrate failure, then add the shared admission policy and use it in `contracts/scripts/deploy.ts` and `deploy-evidence.ts`. Preserve the exact local JSON consumed by CI; emit an additional Fuji receipt record. Verify local deployments still work.
4. [x] IMPLEMENT: add `contracts/scripts/preflight-fuji.ts` using public clients only, compilation artifacts, public role addresses, explicit chain checks, gas/balance/nonce reads and optional post-deployment bytecode/domain/owner/publisher verification. Add npm commands and nonsecret environment examples; no new dependency or CI credential.
5. [x] VERIFY: run contract compile/tests, negative policy tests, script typecheck, keyless Fuji reads, backend lint/typecheck/unit/build and available isolated acceptance checks. Record exact passes/failures and environment limitations; never treat historical Gate 2/3 evidence as a current rerun.
6. [x] TEACH BACK: update `docs/deployment/fuji.md`, `evidence-registry.md`, README/index, audit findings and changelog with role custody, secure env handling, funding formulas, placeholders, receipt/read-back commands, recovery limits and GO/NO-GO gates. Schedule remaining runtime blockers below.
7. Delivery scope: one coherent preflight Conventional Commit with explicit paths, pushed only to the named feature branch, followed by exact-commit hosted CI inspection. Git history and Actions are the delivery evidence; no tag, release, merge or public deployment.

## Separately scoped deployment blockers

- [x] N1: Gate 4A.1 implementation verified at `876657012f479d5159d085ca500d7fc8198c92fc` with [green hosted CI](https://github.com/nkhnam/Shadow-Byte/actions/runs/41201478297), 26 agreement recovery cases and actual N=3 PostgreSQL/local-EVM evidence. See [the confirmation policy](../ref/agreement-confirmation.md) and [completed execution record](done/agreement-confirmation.md). Final delivery still requires exact-final-commit CI; N2/N3 remain separate blockers.
- [ ] Supply five distinct nonzero dedicated testnet role addresses, verify custody/key-derived identity privately, run fresh RPC/preflight checks and approve an itemized gas/funding budget. Do not supply secrets in the repository or chat.
- [ ] Complete exact-feature-commit CI and independently approve the Fuji execution window. This preflight does not authorize any on-chain action.
- [ ] Review the 11 moderate backend ESLint/minimatch dependency advisories in a separately scoped tooling update; current high-severity audit passes, and a forced breaking dependency change is not part of Gate 4A.

## Verification record

Contract compile/typecheck and 17 tests passed; both local deployment scripts preserved CI JSON. Backend lint/typecheck/44 unit tests/build/anchor-integration typecheck passed; frontend 7 unit cases/lint/TypeScript passed. Live keyless Fuji RPC confirmed 43113, artifacts and observed gas price; preflight correctly exited NO_GO because real roles are missing. Gate 2 rerun failed at Docker PostgreSQL startup before tests; other DB/browser gates were not rerun locally. Baseline hosted CI was green. Consult git history and [feature-branch Actions](https://github.com/nkhnam/Shadow-Byte/actions?query=branch%3Afeat%2Funihack-phase2c-oracle-evidence) for the delivery commit and its CI verdict; neither implies Fuji authorization. Detailed evidence is in [the audit](../research/fuji-preflight.md). No Fuji transaction has been sent.
