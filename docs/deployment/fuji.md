# Avalanche Fuji preflight and deployment runbook

Gate 4A prepares deployment and sends **no transactions**. Funding, Fuji deployment, backend public deployment and main merge require separate approval. Current findings/results are in [the preflight audit](../research/fuji-preflight.md); outstanding prerequisites are in [the execution plan](../plan/fuji-preflight.md).

## Roles and custody

Use five distinct nonzero dedicated testnet EOAs. Never use production wallets or publicly known Hardhat accounts. Operators must privately verify custody and key-derived identity; public address separation alone cannot prove this.

| Role | Public variable | Secret custody / authority | Gas |
| --- | --- | --- | --- |
| Deployer / evidence owner | `FUJI_DEPLOYER_ADDRESS` | Offline-controlled `AVALANCHE_FUJI_DEPLOYER_PRIVATE_KEY`, supplied only to the approved contracts process. Retains permanent evidence-publisher rotation authority; no owner transfer exists. | Two deployments plus a separately approved rotation reserve. |
| Agreement relayer | `AGREEMENT_RELAYER_ADDRESS` | Backend-only `BLOCKCHAIN_RELAYER_PRIVATE_KEY`; relays two valid signatures but cannot forge them. | Approved agreement registrations plus reserve. |
| Evidence publisher | `EVIDENCE_PUBLISHER_ADDRESS` | Separate backend-only `EVIDENCE_RELAYER_PRIVATE_KEY`; must equal `publisher()`. | Approved evidence commitments plus reserve. |
| Buyer signer | `BUYER_SIGNER_ADDRESS` | Buyer-controlled wallet, linked/authorized through the authenticated application. Key never enters backend/frontend/contracts configuration. | Existing typed-data signing is gasless. |
| Supplier signer | `SUPPLIER_SIGNER_ADDRESS` | Independent supplier-controlled wallet; reviews/signs the identical frozen version. Key stays in its wallet. | Existing typed-data signing is gasless. |

AgreementRegistry has no owner or relayer allowlist: any sender can relay two valid EOA signatures. Backend organization authorization is essential. EvidenceRegistry accepts only its publisher but does not call AgreementRegistry, verify organization membership or certify measurement truth/independence.

## Secure environment

Hardhat `configVariable` reads process variables or its configured variable source. This repository does **not** automatically load a contracts `.env`; `.env.example` is a template. Inject secrets through an approved secret manager/private process environment. Never put a key/seed phrase in chat, shell command/history, command argument, screenshot, ticket or CI deployment variable. Avoid environment dumps, transcripts and verbose RPC/debug output. RPC URLs can contain provider credentials and must also be redacted.

For Gate 4A, leave all private keys and `FUJI_DEPLOYMENT_APPROVED` unset. Replace these placeholders only with public addresses; placeholders deliberately fail validation:

````powershell
$env:AVALANCHE_FUJI_RPC_URL = 'https://api.avax-test.network/ext/bc/C/rpc'
$env:FUJI_DEPLOYER_ADDRESS = '<DEPLOYER_PUBLIC_ADDRESS>'
$env:AGREEMENT_RELAYER_ADDRESS = '<AGREEMENT_RELAYER_PUBLIC_ADDRESS>'
$env:EVIDENCE_PUBLISHER_ADDRESS = '<EVIDENCE_PUBLISHER_PUBLIC_ADDRESS>'
$env:BUYER_SIGNER_ADDRESS = '<BUYER_PUBLIC_ADDRESS>'
$env:SUPPLIER_SIGNER_ADDRESS = '<SUPPLIER_PUBLIC_ADDRESS>'
````

Keep the deployer key absent from the backend. Backend validation independently rejects equal agreement/evidence key-derived identities. Retain database credentials and `MONITORING_SECRET_ENCRYPTION_KEY` in backend secret storage; securely back up the encryption key or existing webhook secrets become unreadable. The frontend needs only `NEXT_PUBLIC_API_BASE_URL` and public domain/address information returned by the API. No key, mnemonic, webhook secret, database URL or credential-bearing RPC URL belongs in `NEXT_PUBLIC_*`, Next.js `env`, client code or built assets. Check staged files; ignore rules do not remove tracked secrets. Local test keys in CI are public fixtures and must never receive Fuji funds.

## Read-only preflight

From the repository root, verify the exact feature branch, reviewed commit, clean tree and committed lockfiles. CI uses Node.js 24; backend requires at least 24.15. Record any different local version.

````powershell
git branch --show-current
git rev-parse HEAD
git status --short
git diff --check
Set-Location contracts
npm ci
npm run compile
npm run typecheck
npm test
npm run preflight:fuji
````

The preflight uses public clients only: no private-key reads, wallet clients, signatures, backend startup or broadcasts. Hardhat's wrapper uses its simulated network while the script independently queries HTTPS Fuji. Missing public roles/failed checks exit 1 with `NO_GO`; success is only `READ_ONLY_CHECKS_PASS_SEPARATE_APPROVAL_REQUIRED`.

Expected chain is `43113` / `0xa869`; mainnet `43114` must fail. Output includes chain, latest executed block/hash/time/gas limit, gas price, account balances/code/nonces and deployment estimates. Optional backend RPC/chain settings must also identify Fuji. Inspect block freshness and cross-check an independent trusted RPC/explorer: an RPC can lie and one sample does not establish availability. Raw RPC errors/endpoints are suppressed by the scripts.

Preflight fingerprints creation bytecode, runtime templates and build IDs; validates solc 0.8.38, Cancun, optimizer 200 and code-size bounds. Compile from reviewed source with the lockfile first; preflight alone cannot prove an old artifact matches changed source. Retain exact artifacts/build-info in the approved operator evidence store and compare hashes across clean builds. No compiler upgrade is part of Gate 4A.

Backend checks from `backend/`, with nonsecret local test database configuration:

````powershell
npm run lint
npm run typecheck
npm run typecheck:anchor-integration
npm run test:unit
npm run build
npm run test:integration
npm run test:migration-upgrade
npm run test:phase2c-acceptance -- --output '<ABSOLUTE_SCRATCH_ARTIFACT_ROOT>'
npm run test:monitoring-reliability -- --output '<ABSOLUTE_SCRATCH_ARTIFACT_ROOT>'
npm run test:evidence-reliability -- --output '<ABSOLUTE_SCRATCH_ARTIFACT_ROOT>'
````

Database gates need Docker PostgreSQL or the existing guarded `TEST_DATABASE_URL`/CREATEDB mechanism, never production. See [Gate 2](../ref/phase2c-acceptance.md), [3A](../ref/monitoring-worker-reliability.md), [3B](../ref/evidence-publisher-reliability.md), [3C](../ref/monitoring-browser-flows.md) and [3D](../ref/public-https-acceptance.md) for isolation, browser commands and historical results. Gate 3D remains opt-in real Internet collection; local-chain gates do not establish Fuji success.

## Funding and gas plan — no broadcasting

Do not request faucet transfers, transfer AVAX, sign a transaction or start funded workers during preflight. Use public addresses for `eth_getBalance`, `eth_getTransactionCount`, `eth_gasPrice` and `eth_estimateGas`. An unfunded sender may be rejected by estimation; record unavailable, never fabricate funding or zero gas.

For each deployment the script reports measured gas and planning allowance `ceil(gas * 1.2) * (2 * observedGasPrice)` in wei/AVAX. The 20% gas and 2x price margins are assumptions, not measured requirements or enforced fee caps. Re-estimate immediately before separately approved execution and approve a maximum spend. Reserve separately for owner rotation, failed transactions and online operations. Actual plugin fee selection may differ from this allowance.

After approved deployment, estimate `registerAgreement` with the actual unexpired bilateral signatures and `commitEvidence` with the actual authorized batch/sender. Gate 4A generates neither. Budget each online account as its operation allowance times the approved operation count plus explicit reserve; constructor gas is not relayer gas. Registries are nonpayable; no escrow/settlement funding is involved and party typed-data signatures require no AVAX.

Predicted CREATE addresses assume the deployer pending nonce, AgreementRegistry then EvidenceRegistry and no intervening transaction. They are conditional predictions, never receipt addresses. Stop on pending nonce differences and reconcile the busy account first.

## Separately approved execution — STOP here for Gate 4A

Both scripts validate actual chain before wallet access/broadcast. Allowed targets: named `hardhatMainnet`/`localEvm` at 31337, or `avalancheFuji` at 43113 with explicit approval/five distinct roles. The connected deployer must match `FUJI_DEPLOYER_ADDRESS`. A renamed mainnet endpoint fails its actual-chain check; editing the scripts themselves is outside this protection.

Only after the GO checklist and a separate owner approval naming Fuji funding/deployment, inject the dedicated deployer key securely and run from `contracts/`. **These commands are not part of Gate 4A.**

````powershell
try {
    $env:FUJI_DEPLOYMENT_APPROVED = '43113'
    npm run deploy:fuji
    if ($LASTEXITCODE -ne 0) { throw 'Stop: reconcile AgreementRegistry sender/nonce/hash before proceeding.' }
    npm run deploy:evidence:fuji
    if ($LASTEXITCODE -ne 0) { throw 'Stop: reconcile EvidenceRegistry sender/nonce/hash before retrying.' }
} finally {
    Remove-Item Env:FUJI_DEPLOYMENT_APPROVED -ErrorAction SilentlyContinue
    Remove-Item Env:AVALANCHE_FUJI_DEPLOYER_PRIVATE_KEY -ErrorAction SilentlyContinue
}
````

Retain the submitted hash immediately when printed. Scripts wait for a successful receipt at one confirmation and matching contract address; evidence deployment additionally checks owner/publisher. Timeout/nonzero exit after submission is uncertainty. If the RPC fails before a hash is printed, recover from sender/nonce and chain history. Scripts are not a deployment journal; blind retries can deploy additional immutable registries.

## Deployment record placeholders

Leave these unfilled until independent real Fuji verification. No raw signed transaction or secret belongs in a public record.

| Field | AgreementRegistry | EvidenceRegistry |
| --- | --- | --- |
| Reviewed commit / lockfile / artifact hashes | `<REVIEWED_SHA_AND_HASHES>` | `<REVIEWED_SHA_AND_HASHES>` |
| Chain | `43113` | `43113` |
| Deployer / owner | `<DEPLOYER>`; no agreement owner | `<PERMANENT_OWNER>` |
| Constructor arguments | none | `<EVIDENCE_PUBLISHER>` |
| Transaction hash / nonce | `<ACTUAL_TX_HASH>` / `<NONCE>` | `<ACTUAL_TX_HASH>` / `<NONCE>` |
| Receipt status / block / block hash | `<SUCCESS>` / `<BLOCK>` / `<BLOCK_HASH>` | `<SUCCESS>` / `<BLOCK>` / `<BLOCK_HASH>` |
| Actual address | `<AGREEMENT_REGISTRY_ADDRESS>` | `<EVIDENCE_REGISTRY_ADDRESS>` |
| Gas used / effective gas price / fee | `<GAS>` / `<WEI>` / `<GAS_TIMES_PRICE>` | `<GAS>` / `<WEI>` / `<GAS_TIMES_PRICE>` |
| Independent RPC / explorer record | `<VERIFICATION_RECORD>` | `<VERIFICATION_RECORD>` |
| Source verification / runtime hash | `<SOURCE_RECORD_AND_HASH>` | `<SOURCE_RECORD_AND_HASH>` |

## Post-deployment verification

1. Independently check chain 43113, receipt status, sender/nonce, actual address, receipt block identity and gas/fee. Verify source with exact compiler/settings/constructor/build-info; retain evidence, not just a command exit code.
2. Set public `BLOCKCHAIN_REGISTRY_ADDRESS` and `EVIDENCE_REGISTRY_ADDRESS` to real receipt addresses and rerun keyless preflight. In this mode it skips deployment budgeting, compares full evidence runtime and agreement runtime outside compiler-declared immutable slots, then validates EIP-712 name/version/chain/verifying address and evidence owner/publisher. Domain read-back complements source verification. This script does not verify deployment receipts; step 1 is separate.
3. Only after verification and separate activation approval, inject backend runtime RPCs (Fuji), both IDs 43113, actual registries, separate key-derived online identities and explicit confirmation settings. Keep the deployer key absent. Workers auto-start when configured and may broadcast durable pending intents; backend startup is not read-only.
4. Check PostgreSQL migrations/backups, HTTPS origins/session settings, encryption-key custody and pending-intent inventory. Never carry local chain-31337 signed intents into Fuji or point restored intents at another registry. Keep online account nonces and approved budgets separate.
5. Under separate transaction-test approval, link two organization wallets, freeze/review the same snapshot and sign chain 43113 plus the actual registry domain. Compare successful receipt, approval calldata/signatures and stored key/hash/version/organization hashes/expiry/time independently. Signer addresses are in approval calldata, not stored `getAgreement` fields.
6. Export a real authorized evidence batch; compare every commitment field, historical reporter, successful canonical receipt/block time and configured depth; verify the original export and reject a tampered copy. Integrity does not prove objective service availability, SLA breach or independent measurement.

## Confirmation semantics

Avalanche accepted blocks have consensus finality; receipt/state availability follows execution. Missing/timeout receipts stay uncertain. Evidence additionally requires canonical block identity and `head - receiptBlock + 1 >= EVIDENCE_CONFIRMATIONS` for successful and reverted receipts, plus full commitment comparison. Rotation does not invalidate historical reporter identity.

Agreement confirmation now enforces `BLOCKCHAIN_CONFIRMATIONS` through one worker/API proof evaluator: inclusive depth is `head - receiptBlock + 1`, with canonical transaction/receipt and exact frozen registry data required. API verification is read-only; only a live leased worker atomically commits the exact version. Matching external registration without trusted transaction proof requires reconciliation, including R10; it never triggers a duplicate broadcast. Original signed bytes/hash/nonce survive replacement recovery. See [the confirmation policy](../ref/agreement-confirmation.md) for pending/revert/RPC semantics, proof diagnostics and remaining deep-reorg/manual-reconciliation limits. Gate 4A.1 delivery still requires exact-commit green hosted CI; N2 custody/funding and N3 separate execution approval remain mandatory.

## Recovery and rollback limitations

- Timeout/missing receipt/interruption: retain nonce, hash, artifacts/constructor data and wallet history; read chain before retry. No automatic deployment journal/replacement exists.
- Runtime uncertainty: preserve PostgreSQL intents, signed bytes/hash/sender/chain/nonce/leases. Workers safely reuse the same operation; unknown consumed nonce or conflicting state requires reconciliation. Raw signed bytes are replayable authorizations and must not be logged or posted; protect database backups containing them.
- Bad address/domain/bytecode/publisher: stop workers and do not collect signatures for the wrong domain. Publisher rotation uses owner-only `setPublisher(nonzeroAddress)`, itself a separately approved funded transaction. Reconcile old publisher pending operations before rotation.
- Contracts have no proxy upgrade, pause, delete, owner transfer or rollback. Reverting git/restoring PostgreSQL cannot erase chain history. A wrong registry generally needs another approved deployment, new domain/fresh party approvals and explicit reconciliation of old pending operations/history.
- Lost owner key prevents publisher rotation. A compromised publisher can irreversibly post false commitments until rotated; a compromised owner can replace the publisher. Remove online credentials/stop workers, then plan an approved migration where necessary. Database restore never removes chain writes or licenses replay into another registry.

## GO / NO-GO for a separate deployment

Every unchecked item means **NO-GO**. This is an execution approval checklist, not a deployment-success claim.

- [ ] Reviewed feature commit has green hosted CI; local/environment limitations are resolved or explicitly accepted with their scope.
- [ ] Clean lockfile compile, script typecheck, contract/policy suite and required Gate 2/3 regressions pass; public fixture accounts receive no funds.
- [ ] Trusted HTTPS RPC and independent source identify 43113 with fresh executed blocks; backend RPC settings agree.
- [ ] Five distinct dedicated testnet roles have verified custody/key-derived identity; permanent owner and authorized publisher are understood.
- [ ] Fresh gas estimates, separate deployment/relayer/publisher/rotation budgets, maximum spend and clear pending nonces are approved; no funding under Gate 4A.
- [ ] Gate 4A.1 confirmation implementation has exact-commit green hosted CI and N=3 local-EVM/PostgreSQL evidence; agreement/evidence depth is configured explicitly.
- [ ] Secrets/frontend/public config/logging/staged diff are checked; no live key/seed/credential URL or raw signed operation is exposed.
- [ ] Address/receipt placeholders remain unfilled until execution; exact artifact/source/runtime/domain/owner/publisher/receipt verification is scheduled.
- [ ] PostgreSQL/migrations/backups/encryption key/pending intents/monitoring/recovery custody are ready before later backend activation.
- [ ] Separate approval names Fuji funding/deployment; backend public deployment and main merge remain separately gated.

## Official references

Read 2026-10-31: [network parameters](https://build.avax.network/docs/primary-network), [Cancun/Hardhat compatibility](https://docs.avax.network/docs/primary-network/verify-contract/hardhat), [C-Chain execution/RPC](https://docs.avax.network/docs/rpcs/c-chain) and [accepted-block finality](https://build.avax.network/docs/primary-network/exchange-integration). Recheck before the approved window.
