# Avalanche Fuji preflight and deployment runbook

Gate 4A prepares deployment and sends **no transactions**. Funding, Fuji deployment, backend public deployment and main merge require separate approval. Current findings/results are in [the preflight audit](../research/fuji-preflight.md); outstanding prerequisites are in [the execution plan](../plan/fuji-preflight.md).

## Roles and custody

Use five distinct nonzero dedicated testnet EOAs. Never use production wallets or publicly known Hardhat accounts. Operators must privately verify custody and key-derived identity; public address separation alone cannot prove this.

| Role | Public variable | Secret custody / authority | Gas |
| --- | --- | --- | --- |
| Deployer / registry owner | `FUJI_DEPLOYER_ADDRESS` | Private prompt through `deploy-private.ps1`, supplied through stdin only to the approved contracts process. Retains permanent publisher-rotation authority for both registries; no owner transfer exists. | Two deployments plus a separately approved rotation reserve. |
| Agreement relayer | `AGREEMENT_RELAYER_ADDRESS` | Backend-only `BLOCKCHAIN_RELAYER_PRIVATE_KEY`; must equal AgreementRegistry `publisher()`. Relays two valid signatures but cannot forge them. | Approved agreement registrations plus reserve. |
| Evidence publisher | `EVIDENCE_PUBLISHER_ADDRESS` | Separate backend-only `EVIDENCE_RELAYER_PRIVATE_KEY`; must equal `publisher()`. | Approved evidence commitments plus reserve. |
| Buyer signer | `BUYER_SIGNER_ADDRESS` | Buyer-controlled wallet, linked/authorized through the authenticated application. Key never enters backend/frontend/contracts configuration. | Existing typed-data signing is gasless. |
| Supplier signer | `SUPPLIER_SIGNER_ADDRESS` | Independent supplier-controlled wallet; reviews/signs the identical frozen version. Key stays in its wallet. | Existing typed-data signing is gasless. |

AgreementRegistry accepts registrations only from its configured publisher and still verifies both EOA signatures. Its constructor takes the public `AGREEMENT_RELAYER_ADDRESS`; the deployer permanently owns `setPublisher(nonzeroAddress)`, following the EvidenceRegistry pattern. This prevents an outsider from occupying a known agreement key using two attacker-controlled signers. The authorized publisher and owner remain trusted: organization authorization is enforced by the backend, not inferred by the contract. EvidenceRegistry accepts only its separate publisher but does not call AgreementRegistry, verify organization membership or certify measurement truth/independence.

The 11 November 2026 authorization repair changes AgreementRegistry creation/runtime bytecode and constructor arguments. Historical preflight hashes, gas estimates and unsigned previews describe older source and are not valid approval inputs for this revision. Recompile, rerun the local checks and generate fresh read-only preflight/preview evidence before any separately approved deployment. No public deployment is performed by this repair.

For a local chain, `scripts/deploy.ts` uses public `AGREEMENT_RELAYER_ADDRESS` when supplied, otherwise its local deployer. Set the address explicitly when the backend relayer differs from that deployer. The local JSON address output remains `{chainId, registryAddress}` for existing launchers; receipt, owner and publisher are verified before it is printed.

## Secure environment

Hardhat reads public RPC configuration through `configVariable`. Fuji accounts are empty in Hardhat configuration: deploy scripts read the key from stdin and ignore the legacy private-key environment variable. This repository does **not** automatically load a contracts `.env`; `.env.example` is a template. Never put a key/seed phrase in chat, shell command/history, command argument, screenshot, ticket or CI deployment variable. Avoid environment dumps, transcripts and verbose RPC/debug output. RPC URLs can contain provider credentials and must also be redacted.

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

## Local Fuji demo database and vault

`compose.fuji.yaml` runs only PostgreSQL 17 on `127.0.0.1:5434`, with the separate `sla-fuji-postgres-data` volume. Start or stop it with `docker compose -f compose.fuji.yaml up -d --wait postgres` or `docker compose -f compose.fuji.yaml stop`; do not remove the volume to reset uncertain intent history. Starting this service does not create the application database or run migrations automatically.

The local setup on 2026-10-31 created `sladex_fuji_demo`, applied all four existing Prisma migrations and verified zero `AnchorIntent` and `EvidenceAnchorIntent` rows. `sladex_fuji_migrator` owns the database. `sladex_fuji_app` has schema usage and table DML/sequence access, but no schema creation, migration-table access or administrative role privileges. The operator subsequently set both passwords privately in KeePassXC and enabled only the application login; the migrator remains `NOLOGIN`. At 15:36:07 UTC the application account successfully connected through `127.0.0.1:5434`, validated keyless configuration and read zero agreement/evidence intents inside a rolled-back read-only transaction. The backend is not started.

The container generates a bootstrap administrator password in memory during startup; no password is committed in Compose or recorded in an environment file. Local container socket administration is trusted: access to Docker is equivalent to database administration. The bootstrap password is not a runtime credential or a vault backup.

The operator reports that the KeePassXC vault outside the repository is created and backed up. Vault contents and the master password were not inspected. Keep automatic locking and an encrypted backup on another device. Do not put the wallet recovery phrase or deployer/buyer/supplier keys in the backend vault. Later, store separate entries for the two online keys and `MONITORING_SECRET_ENCRYPTION_KEY`; neither was provisioned in this preparation. `backend/scripts/check-fuji-db.ps1` prompts privately for the application database password, supplies a URL only to a diagnostic child process, restores its previous environment and saves an allowlisted result without credentials. It is a connection checker, not a backend launcher.

Use `backend/scripts/start-local-backend.ps1` for keyless local operation. It prompts for the application DB password without echo, passes its URL to a Node supervisor through stdin and launches the built backend with an allowlisted environment. It does not read KeePassXC or export wallet keys. It fixes `LOCAL_SAFE_MODE=true`, `HOST=127.0.0.1`, `WORKERS_ENABLED=false`, port 4000 and the local frontend origin. It excludes inherited wallet keys, RPC configuration and `NODE_OPTIONS`; safe mode ignores `.env` files and rejects blockchain configuration, enabled workers or a non-loopback host. All four background services (monitoring, retention, agreement and evidence) guard both startup and their public processing entries.

From `backend/`, build with `npm run build` before launching. Prisma generation requires a syntactically valid `DATABASE_URL` even though generation does not connect; supply a nonsecret build-only placeholder in the build process when no credential is present, then remove it. Run `powershell -NoProfile -File scripts/start-local-backend.ps1 -Check` for a private-prompt startup/DB-health check that stops the API afterwards; omit `-Check` only when an ongoing local API session is intended. Ctrl+C stops the session; the backend also closes on supervisor IPC disconnect. Raw backend stdout/stderr are withheld because startup exceptions can include credentials; the supervisor emits only a safe PASS/failure category. Diagnose failed startup without dumping its environment or raw credential-bearing output.

The password necessarily exists in process memory and the backend's private environment while running; a local administrator can inspect it. This is private-prompt process injection, not automatic vault integration or protection from a compromised host. The launcher clears its unmanaged password buffer and does not persist a URL or password file. Keep the default `npm run dev`/`npm start` stopped under a no-worker restriction: outside safe mode, workers remain enabled and the default bind remains `0.0.0.0` for compatibility. No online-role key injection is implemented or authorized by this launcher.

The approved demo planning allowance is 10 agreement registrations plus 2 failure slots, and 100 evidence batches plus 20 failure slots: 300,000 gas per transaction at an assumed 1 gwei gives 0.0036 AVAX for the relayer and 0.036 AVAX for the publisher. The owner also approved 0.002 AVAX for two deployments and 0.0002 AVAX for publisher-rotation reserve, making the total planning envelope 0.0418 AVAX. These are planning assumptions, not measured runtime gas or enforced spending caps. The owner confirmed testnet-only wallets, safe private phrase backup, shared-custody acceptance and exclusive relayer/publisher use. The five demo accounts share a recovery phrase and one operator; independent party custody and offline owner custody are not established. N2 planning is closed with conditions recorded in the execution plan; key-derived identity, actual gas, fresh independent chain checks, secret injection and fee/spend controls remain execution prerequisites. N3 execution, key export, funding and worker startup are not authorized.

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

### N3 preparation tools — no key or broadcast by default

From `contracts/`, run `npx hardhat run scripts/preview-fuji-deploy.ts --network hardhatMainnet --no-compile` to obtain an unsigned preview from `fuji-deployment-draft.json`. The wrapper uses a simulated network; the script uses public clients against Fuji and PublicNode, requires the same executed block hash, checks the deployer is an EOA with clear nonces and estimates both deployments. It never reads a key or signs/sends a transaction. Output includes full initcode hashes (including each registry's distinct publisher argument), proposed gas/fees, starting nonce and conditional CREATE addresses; it explicitly leaves deployment authorization and signer verification false. The second deployment is hypothetical until the first succeeds. An unfunded/RPC-rejected estimate fails closed.

Draft gas ceilings are 1,200,000 for AgreementRegistry and 800,000 for EvidenceRegistry. Preview proposes a fixed legacy gas price of twice the observed RPC price, rejecting a proposal above the draft 1 gwei ceiling. The pair's hard fee-envelope ceiling is 0.002 AVAX, excluding the separately reserved 0.0002 AVAX for rotation. These draft inputs are not execution approval. Re-read and approve the actual preview just before each transaction.

`powershell -NoProfile -File scripts/verify-deployer.ps1` stops without prompting. Only after separate authorization for private key export/input, adding `-IdentityCheckApproved` prompts without echo and passes the input via stdin to an environment-isolated identity checker. It derives and compares the address against the public draft; it never signs a message or transaction, creates a wallet client or contacts RPC. No key, signature or signed transaction is written to disk/output. Immutable strings still exist in process memory until collection/exit; local administrators can inspect memory. This identity tool does not deploy. Do not invoke it with a real key during preparation.

`scripts/deploy-private.ps1` provides execution-time provisioning after separate key-input and per-contract deployment approval. Its default invocation stops before prompting. `-DeploymentApproved -Contract AgreementRegistry` (or separately `EvidenceRegistry`) also requires the exact public approval and all limits below. It copies only OS essentials and named public approval fields, fixes the public Avalanche RPC, excludes inherited keys and `NODE_OPTIONS`, uses `--no-compile`, and sends hidden input through stdin. The deploy script checks chain/admission before reading the key, bounds input to 128 bytes, checks the derived public identity and signs locally. Existing nonce/initcode/fee/receipt checks remain. No backend or worker is launched. The launcher clears its unmanaged key buffer and terminates the child on failure or a five-minute timeout. Termination cannot undo a submitted transaction; reconcile sender/nonce/hash before any retry. JavaScript strings and the signing account remain in memory until collection/exit and cannot be guaranteed zeroed. This is private process input, not vault integration or protection from a compromised host.

In addition to the five public roles and `FUJI_DEPLOYMENT_APPROVED=43113`, execution requires these public values, reviewed for the one contract being sent:

| Variable | Meaning |
| --- | --- |
| `FUJI_APPROVED_CONTRACT` | Exactly `AgreementRegistry` or `EvidenceRegistry`; approve each step separately. |
| `FUJI_APPROVED_INITCODE_HASH` | Reviewed full initcode hash for that contract, including constructor arguments. |
| `FUJI_AGREEMENT_DEPLOYMENT_TX_HASH` | Required for EvidenceRegistry: verified first deployment hash, used to validate its receipt/transaction and actual fee. |
| `FUJI_DEPLOYER_START_NONCE` | Starting nonce for the pair; second deployment must use start + 1. |
| `FUJI_GAS_PRICE_WEI` | Explicit fixed legacy gas price; do not substitute the draft price ceiling automatically. |
| `FUJI_AGREEMENT_GAS_LIMIT`, `FUJI_EVIDENCE_GAS_LIMIT` | Approved per-transaction limits, each covering the fresh estimate plus 20% margin. |
| `FUJI_MAX_DEPLOYMENT_FEE_WEI` | Pair envelope, at most `2000000000000000` wei; sum of both gas limits times fixed gas price must fit. |

Both Fuji paths pass explicit nonce, gas, gasPrice and zero value to the wallet. Admission rejects missing/invalid limits, wrong contract/initcode, pending/consumed nonces, an observed price above the approved price or insufficient gas margin. A transaction can fail instead of increasing its approved fee. The EvidenceRegistry path verifies the first transaction's sender, chain, nonce, zero value and full initcode against AgreementRegistry, a successful receipt at its predicted address, canonical block identity and matching runtime outside immutable slots. It adds that receipt's actual fee to the second transaction's maximum fee and rejects a sum above the pair envelope, even if fee allocations changed between invocations. These controls bound these two transactions, not unrelated wallet activity, funding amounts, rotations or online workers. Exclusive deployer use and independent receipt/domain verification remain mandatory. No automatic retry or replacement is added.

Both scripts validate actual chain before wallet access/broadcast. Allowed targets: named `hardhatMainnet`/`localEvm` at 31337, or `avalancheFuji` at 43113 with explicit approval/five distinct roles. The connected deployer must match `FUJI_DEPLOYER_ADDRESS`. A renamed mainnet endpoint fails its actual-chain check; editing the scripts themselves is outside this protection.

Only after the GO checklist and separate owner approval naming Fuji funding/deployment, arrange secure deployer-key provisioning and the public execution limits above. Run from `contracts/` one approved contract at a time. **These commands are not part of preparation.**

````powershell
try {
    $env:FUJI_DEPLOYMENT_APPROVED = '43113'
    powershell -NoProfile -File scripts/deploy-private.ps1 -DeploymentApproved -Contract AgreementRegistry
    if ($LASTEXITCODE -ne 0) { throw 'Stop: reconcile AgreementRegistry sender/nonce/hash before proceeding.' }
} finally {
    Remove-Item Env:FUJI_DEPLOYMENT_APPROVED -ErrorAction SilentlyContinue
}
````

Stop and independently verify the AgreementRegistry receipt/runtime/domain. Only then obtain a separate EvidenceRegistry approval, set its specific contract/initcode hash with the same pair starting nonce, refresh all checks and invoke the private launcher with `-DeploymentApproved -Contract EvidenceRegistry`. Never chain the two commands automatically or reuse the first contract's hash/approval for the second. Do not pipe a real key from shell text or use direct npm deployment commands as a private-input interface.

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
