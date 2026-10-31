# Phase 2B signing threat model

> updated 2026-10-31 · 8766570

## Security boundary

The API authenticates each request, derives the active organization from verified membership, and checks role and agreement participation before exposing terms or changing workflow state. The browser is untrusted. Organization IDs, roles, agreement versions, signer addresses, hashes, status values and signatures supplied by a client are revalidated against persisted records.

The protocol proves that two authorized EOA wallets approved one canonical agreement snapshot under one EIP-712 domain. It does not establish a person's civil identity, employment authority outside SLA-DEX, legal validity, or universal digital-signature compliance.

## Assets and trust assumptions

| Asset | Where it lives | Security property |
|---|---|---|
| SLA terms and personal data | PostgreSQL and authenticated API | Never emitted to the registry |
| Organization participation | PostgreSQL | Invitation is scoped to agreement, organization, version and expiry |
| Wallet authorization | PostgreSQL | OWNER/ADMIN proves wallet control with a short-lived one-use challenge |
| Frozen snapshot and signatures | PostgreSQL | Snapshot is immutable; EIP-712 signs its digest and version-specific key |
| Registry record | Avalanche C-Chain | Public immutable key, hash, version, organization hashes, validity deadline and registration time; signer addresses/signatures remain visible in transaction calldata |
| Relayer key and AVAX | Backend environment/secret store and funded account | Relayer can submit valid signatures but cannot manufacture either party's approval |

Assumptions: TLS protects deployed API sessions; the database and its credentials are controlled by the operator; wallet software correctly displays and signs typed data; the selected RPC returns the configured chain; and each organization's OWNER/ADMIN authority is accurate in SLA-DEX. Public chain metadata is observable and linkable.

## Threats and controls

| Threat | Control | Remaining limit |
|---|---|---|
| MEMBER accepts, links a signer or signs | Server-side OWNER/ADMIN role check on each mutating endpoint | Compromised OWNER/ADMIN session remains privileged |
| Unrelated organization reads private terms | Agreement reads require owner or accepted participant membership; invitation inbox is organization-scoped | API operator/database access can read off-chain terms |
| Client supplies a trusted-looking organization ID or party name | Resolve organization in database and bind the invitation to the current agreement/version; party roles come from organization records | Organization registration does not prove external legal identity |
| Wallet address substitution | Short-lived one-use wallet-link challenge binds organization, user and address; frozen snapshot binds selected authorized addresses | A user can approve a malicious wallet prompt if their wallet UI is compromised or misleading |
| Terms change after one signature | Persisted immutable snapshot; amendment creates a new version and invalidates old unanchored signatures | Already signed content cannot be recalled from a user's memory or external records |
| Forged or wrong-wallet signature | Recover signer server-side and compare with the frozen party wallet; contract independently verifies both EOA signatures | ERC-1271 contract wallets are unsupported; the contract only checks addresses named in the approval and does not know which organizations approved them |
| Replay across agreement/version, chain or registry | Version-specific agreement key, nonce/deadline and EIP-712 domain binds chain ID and verifying contract | A separately deployed contract with the same code has its own domain and state |
| Duplicate request or relayer restart | Unique durable intent, DB lease, persisted signed bytes/hash/chain/relayer/nonce before broadcast, same-transaction rebroadcast and registry read-before-retry | Relayer can delay or censor transactions; an advanced nonce without matching registry state requires operator investigation |
| RPC outage, wrong network or low relayer balance | Chain ID validation, explicit pending/failed/reconciliation state, retry from durable intent | Availability depends on RPC and relayer funding |
| Transaction replacement, revert or DB failure after inclusion | Shared proof evaluator validates original signed identity, replacement chain/sender/nonce/destination/zero value/exact calldata, canonical receipt depth and pinned registry data; worker uses atomic leased/version-fenced writes | An unknown replacement that consumed the nonce without the expected record requires manual reconciliation; deep reorg after durable confirmation is not automatically rolled back |
| Registry-only confirmation or API bypass | External matching records without trusted transaction proof fail closed; verification API never writes durable state; monitoring requires worker-confirmed active version and intent | RPC truthfulness is trusted; external transaction discovery/manual reconciliation remains outside Gate 4A.1 |
| Confidential terms leak through blockchain | Registry stores digest, version key, organization hashes, validity deadline and registration timestamp; wallet identities/signatures are exposed by calldata | Hashes and participant addresses are public and may be correlated with external information |

## Signing lifecycle

1. OWNER/ADMIN of the owner organization invites an existing CUSTOMER or PROVIDER organization for the current version.
2. OWNER/ADMIN of the invited organization accepts or rejects the scoped invitation. Acceptance grants that organization access to the terms and signing flow.
3. Each party links an EOA using a short-lived typed challenge. The server stores the verified address and role.
4. Preparation freezes the canonical snapshot, selected wallets, expiry and EIP-712 payload. Both parties review the exact stored snapshot before signing.
5. The API verifies each signature against its frozen signer and records it once. A completed pair creates a durable anchor intent transactionally.
6. The relayer submits both signatures. Only its live leased worker can durably confirm the exact version after shared proof evaluation: canonical successful receipt, inclusive configured depth and matching registry data at a rechecked chain head. API verification is read-only. See [the confirmation policy](../ref/agreement-confirmation.md) for replacement, RPC, external registration and reconciliation semantics.
7. Amendments use a new immutable AgreementVersion and restart invitation/signing. An anchored snapshot is never edited in place.

The contract enforces cryptographic EOA approval for the two addresses in the typed message, version/hash/deadline binding, chain and verifying-contract domain separation, and one-time registration per agreement key. SLA-DEX alone enforces that those addresses were authorized by the participating organizations. The registry does not implement ERC-1271 and cannot establish legal identity, employment authority or legal-signature compliance.

## Operational controls

- Keep `AVALANCHE_FUJI_DEPLOYER_PRIVATE_KEY` and backend relayer secrets in local environment configuration or a secret manager; never commit or paste them into chat.
- CI uses PostgreSQL service state and a deterministic local EVM only. It has no Fuji deploy job or network credentials.
- Fuji deployment is a separate approved action. Confirm chain ID 43113 and deployment account funding before sending a transaction.
- Monitor pending intents, retry classifications, mismatched read-back and relayer balance. A transaction hash alone is not proof of anchoring.
- Treat ERC-1271 support, formal legal identity verification, and legal-signature compliance as unsupported.
