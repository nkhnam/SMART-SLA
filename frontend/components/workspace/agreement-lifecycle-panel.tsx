"use client";

import { useEffect, useState } from "react";
import { Status } from "@/components/ui";
import {
  ApiError,
  createAgreementInvitation,
  createSignerChallenge,
  getAgreementAnchor,
  getAgreementSigning,
  listAuthorizedSigners,
  prepareAgreementSigning,
  retryAgreementAnchor,
  selectAgreementSigner,
  submitAgreementSignature,
  verifySignerChallenge,
  verifyAgreementOnChain,
  type AgreementAnchorView,
  type AgreementSigningView,
  type AuthorizedSigner,
  type LiveAgreement
} from "@/lib/live-api";
import { ensureWalletChain, getInjectedWallet, requestWalletAccounts, signWalletTypedData } from "@/lib/wallet";

type Props = {
  agreement: LiveAgreement;
  organizationId: string;
  userId: string;
  canApprove: boolean;
  onRefreshAgreement: () => Promise<void>;
};

export function AgreementLifecyclePanel({ agreement, organizationId, userId, canApprove, onRefreshAgreement }: Props) {
  const [signers, setSigners] = useState<AuthorizedSigner[]>([]);
  const [signing, setSigning] = useState<AgreementSigningView | null>(null);
  const [anchor, setAnchor] = useState<AgreementAnchorView | null>(null);
  const [selectedSignerId, setSelectedSignerId] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshSigning() {
    const [signingResult, anchorResult, signerResult] = await Promise.allSettled([
      getAgreementSigning(organizationId, agreement.id),
      getAgreementAnchor(organizationId, agreement.id),
      listAuthorizedSigners(organizationId)
    ]);
    if (signingResult.status === "fulfilled") setSigning(signingResult.value);
    if (anchorResult.status === "fulfilled") setAnchor(anchorResult.value);
    if (signerResult.status === "fulfilled") {
      setSigners(signerResult.value);
      setSelectedSignerId((current) => signerResult.value.some((signer) => signer.id === current) ? current : signerResult.value[0]?.id ?? "");
    }
    const failed = [signingResult, anchorResult, signerResult].find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  useEffect(() => {
    if (agreement.status === "DRAFT" || agreement.status === "AWAITING_COUNTERPARTY" || agreement.status === "REJECTED" || agreement.status === "CANCELLED") return;
    let active = true;
    void Promise.all([
      getAgreementSigning(organizationId, agreement.id),
      getAgreementAnchor(organizationId, agreement.id),
      listAuthorizedSigners(organizationId)
    ]).then(([currentSigning, currentAnchor, currentSigners]) => {
      if (!active) return;
      setSigning(currentSigning);
      setAnchor(currentAnchor);
      setSigners(currentSigners);
      setSelectedSignerId((current) => currentSigners.some((signer) => signer.id === current) ? current : currentSigners[0]?.id ?? "");
    }).catch((cause) => {
      if (active) setError(cause instanceof ApiError ? cause.message : "Agreement workflow could not be loaded.");
    });
    return () => { active = false; };
  }, [agreement.id, agreement.status, agreement.version, organizationId]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on || !provider.removeListener) return;
    const accountsChanged = (...accounts: unknown[]) => {
      const next = accounts[0];
      setWalletAddress(Array.isArray(next) && typeof next[0] === "string" ? next[0] : "");
    };
    const chainChanged = () => setNotice("Wallet network changed. The next signing action will verify the required chain again.");
    provider.on("accountsChanged", accountsChanged);
    provider.on("chainChanged", chainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, []);

  useEffect(() => {
    if (agreement.status !== "ANCHOR_PENDING" || anchor?.blockchainStatus === "CONFIRMED") return;
    const timer = window.setInterval(() => {
      void getAgreementAnchor(organizationId, agreement.id).then(setAnchor).catch(() => undefined);
      void onRefreshAgreement();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [agreement.id, agreement.status, anchor?.blockchainStatus, onRefreshAgreement, organizationId]);

  async function run(action: () => Promise<void>, successMessage?: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (cause) {
      setError(cause instanceof ApiError || cause instanceof Error ? cause.message : "The requested action could not be completed.");
    } finally {
      setPending(false);
    }
  }

  async function inviteCounterparty() {
    if (!counterpartyId.trim()) throw new Error("Enter the registered counterparty organization ID.");
    await createAgreementInvitation(organizationId, agreement.id, counterpartyId.trim());
    setCounterpartyId("");
    await onRefreshAgreement();
  }

  async function linkWallet() {
    const provider = getInjectedWallet();
    const [account] = await requestWalletAccounts(provider);
    if (!account) throw new Error("Connect a wallet account first.");
    const challenge = await createSignerChallenge(organizationId, account);
    await ensureWalletChain(provider, challenge.typedData.domain.chainId);
    const signature = await signWalletTypedData(provider, account, challenge.typedData);
    await verifySignerChallenge(organizationId, challenge.challengeId, signature);
    setWalletAddress(account);
    await refreshSigning();
    setNotice("Wallet ownership verified for this organization.");
  }

  async function chooseSigner() {
    if (!selectedSignerId) throw new Error("Verify a wallet before choosing a signer.");
    await selectAgreementSigner(organizationId, agreement.id, selectedSignerId);
    await refreshSigning();
  }

  async function freezeSnapshot() {
    const snapshot = await prepareAgreementSigning(organizationId, agreement.id);
    setSigning({
      agreementId: agreement.id,
      version: agreement.version,
      agreementStatus: agreement.status,
      signatureStatus: snapshot.signatureStatus,
      snapshot
    });
    await refreshSigning();
  }

  async function signSnapshot() {
    if (!signing?.snapshot) throw new Error("The agreement does not have an active signing snapshot.");
    const provider = getInjectedWallet();
    const [account] = await requestWalletAccounts(provider);
    if (!account) throw new Error("Connect the authorized signer wallet first.");
    const typedData = signing.snapshot.typedData;
    await ensureWalletChain(provider, typedData.domain.chainId);
    const expectedSigners = [typedData.message.buyerSigner, typedData.message.supplierSigner].filter((value): value is string => typeof value === "string");
    if (!expectedSigners.some((address) => address.toLowerCase() === account.toLowerCase())) {
      throw new Error("The connected account does not match either wallet frozen into this agreement.");
    }
    const linkedWallet = signers.find((signer) => signer.address.toLowerCase() === account.toLowerCase());
    if (!linkedWallet || linkedWallet.user.id !== userId) throw new Error("Link this wallet to your organization using the current account before signing.");
    const signature = await signWalletTypedData(provider, account, typedData);
    await submitAgreementSignature(organizationId, agreement.id, signature);
    setWalletAddress(account);
    await refreshSigning();
    await onRefreshAgreement();
    setNotice("Signature submitted and verified by the backend.");
  }

  async function retryAnchor() {
    const result = await retryAgreementAnchor(organizationId, agreement.id);
    await getAgreementAnchor(organizationId, agreement.id).then(setAnchor);
    setNotice(result.blockchainStatus === "SUBMISSION_UNCERTAIN" ? "The existing transaction will be checked again." : "Anchor transaction queued for retry.");
  }

  async function verifyOnChain() {
    const result = await verifyAgreementOnChain(organizationId, agreement.id);
    if (!result.verified) throw new Error(`Registry verification failed: ${result.reason ?? "unknown result"}.`);
    await getAgreementAnchor(organizationId, agreement.id).then(setAnchor);
    await onRefreshAgreement();
    setNotice(`Registry record verified${result.transactionHash ? ` · ${result.transactionHash}` : ""}.`);
  }

  const sectionClass = "mt-6 rounded-xl border border-border bg-white p-5 sm:p-6";
  const submittedParties = new Set(signing?.snapshot?.signatures.map((signature) => signature.party) ?? []);
  const chainId = signing?.snapshot?.typedData.domain.chainId;

  return <section className={sectionClass}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-base font-semibold">Agreement workflow</h2><p className="mt-1 text-sm text-muted">Version {agreement.version} · shared status is recorded by the API.</p></div>
      <Status tone={agreement.status === "ANCHOR_CONFIRMED" ? "green" : agreement.status === "ANCHOR_FAILED" || agreement.status === "REJECTED" || agreement.status === "CANCELLED" ? "red" : "amber"}>{agreement.status.replaceAll("_", " ")}</Status>
    </div>
    {agreement.parties && agreement.parties.length > 0 && <ul className="mt-4 grid gap-2 sm:grid-cols-2">
      {agreement.parties.map((party) => <li key={party.organization.id} className="rounded-lg border border-border p-3 text-sm"><p className="font-medium">{party.role}: {party.organization.name}</p><p className="mt-1 text-xs text-muted">Accepted {new Date(party.acceptedAt).toLocaleString()}</p></li>)}
    </ul>}

    {agreement.status === "DRAFT" && agreement.ownerOrganizationId === organizationId && canApprove && <div className="mt-5 border-t border-border pt-4">
      <label className="block text-sm font-medium">Invite a registered counterparty
        <input value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)} placeholder="Counterparty organization UUID" className="mt-2 w-full rounded-lg border border-border px-3 py-2.5 text-sm" />
      </label>
      <p className="mt-1 text-xs text-muted">The organization ID is available from its administrator. Terms stay private until it accepts.</p>
      <button type="button" disabled={pending} onClick={() => void run(inviteCounterparty)} className="mt-3 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Sending…" : "Send invitation"}</button>
    </div>}

    {agreement.status === "AWAITING_COUNTERPARTY" && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-warning">Invitation sent. The counterparty must accept before either organization can access the agreement terms or select signing wallets.</p>}
    {agreement.status === "REJECTED" && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-danger">The counterparty rejected this version. Amend the terms to begin a new approval round.</p>}
    {agreement.status === "CANCELLED" && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-muted">This agreement was cancelled before registration.</p>}

    {agreement.status === "AWAITING_SIGNATURES" && <div className="mt-5 space-y-4 border-t border-border pt-4">
      <div><h3 className="text-sm font-semibold">Authorize the organization signer</h3><p className="mt-1 text-sm text-muted">Wallet proof links one EOA to the current organization. The wallet signs typed data locally; private keys never reach this app.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending || !canApprove} onClick={() => void run(linkWallet)} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-60">{pending ? "Waiting for wallet…" : "Connect and verify wallet"}</button>
        {walletAddress && <span className="font-mono text-xs text-muted">Connected {walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}</span>}
      </div>
      {signers.length > 0 && <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-60 flex-1 text-sm font-medium">Authorized wallet
          <select value={selectedSignerId} onChange={(event) => setSelectedSignerId(event.target.value)} disabled={!canApprove || pending} className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm">
            {signers.map((signer) => <option key={signer.id} value={signer.id}>{signer.address} · {signer.user.displayName}</option>)}
          </select>
        </label>
        <button type="button" disabled={!canApprove || pending || !selectedSignerId} onClick={() => void run(chooseSigner, "Signer wallet selected for this agreement version.")} className="rounded-lg border border-border px-3 py-2.5 text-sm font-semibold disabled:opacity-60">Select signer</button>
      </div>}
      {canApprove && agreement.ownerOrganizationId === organizationId && !signing?.snapshot && <div>
        <button type="button" disabled={pending} onClick={() => void run(freezeSnapshot, "Signing snapshot frozen. Review the hash before signing.")} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Freeze version for signing</button>
        <p className="mt-2 text-xs text-muted">This is available after both organizations have selected an authorized signer.</p>
      </div>}
    </div>}

    {signing?.snapshot && agreement.status !== "ANCHOR_CONFIRMED" && <div className="mt-5 rounded-lg border border-border bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Frozen version {signing.version}</h3><Status tone={signing.signatureStatus === "COMPLETE" ? "green" : "amber"}>{signing.signatureStatus}</Status></div>
      <p className="mt-2 break-all font-mono text-xs text-muted">Agreement hash: {signing.snapshot.hash}</p>
      <p className="mt-1 break-all font-mono text-xs text-muted">Agreement key: {signing.snapshot.agreementKey}</p>
      <details className="mt-3 rounded-lg border border-border bg-white p-3">
        <summary className="cursor-pointer text-xs font-semibold">Review the complete frozen SLA terms</summary>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">{JSON.stringify(signing.snapshot.snapshot, null, 2)}</pre>
      </details>
      <p className="mt-1 text-xs text-muted">Expires {new Date(signing.snapshot.validUntil).toLocaleString()} · chain {chainId}</p>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div><dt className="text-muted">Buyer wallet</dt><dd className="break-all font-mono">{String(signing.snapshot.typedData.message.buyerSigner)}</dd></div>
        <div><dt className="text-muted">Supplier wallet</dt><dd className="break-all font-mono">{String(signing.snapshot.typedData.message.supplierSigner)}</dd></div>
      </dl>
      <ul className="mt-3 space-y-1 text-xs">
        {["BUYER", "SUPPLIER"].map((party) => <li key={party} className="flex items-center gap-2"><Status tone={submittedParties.has(party as "BUYER" | "SUPPLIER") ? "green" : "neutral"}>{submittedParties.has(party as "BUYER" | "SUPPLIER") ? "SIGNED" : "PENDING"}</Status>{party} approval</li>)}
      </ul>
      {agreement.status === "AWAITING_SIGNATURES" && canApprove && <button type="button" disabled={pending} onClick={() => void run(signSnapshot)} className="mt-4 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Sign with connected wallet</button>}
    </div>}

    {(agreement.status === "ANCHOR_PENDING" || agreement.status === "ANCHOR_CONFIRMED" || agreement.status === "ANCHOR_FAILED") && <div className="mt-5 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Avalanche registration</h3><Status tone={anchor?.blockchainStatus === "CONFIRMED" ? "green" : anchor?.blockchainStatus === "FAILED" ? "red" : "amber"}>{anchor?.blockchainStatus ?? agreement.blockchainStatus}</Status></div>
      <p className="mt-1 text-sm text-muted">The record is confirmed only after the relayer reads the matching registry entry back from chain {chainId ?? "configured network"}.</p>
      {(anchor?.blockchainStatus ?? agreement.blockchainStatus) === "SUBMISSION_UNCERTAIN" && <p className="mt-2 text-sm text-warning">Submission outcome is unknown. The backend checks the same signed transaction before sending it again.</p>}
      {anchor?.anchor?.transactionHash && <p className="mt-2 break-all font-mono text-xs text-muted">Transaction: {anchor.anchor.transactionHash}</p>}
      {anchor?.anchor?.lastError && <p role="alert" className="mt-2 text-sm text-danger">Anchor error: {anchor.anchor.lastError}</p>}
      <button type="button" disabled={pending} onClick={() => void run(verifyOnChain)} className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-60">Verify registry record</button>
      {agreement.status === "ANCHOR_FAILED" && canApprove && <button type="button" disabled={pending} onClick={() => void run(retryAnchor)} className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-60">Retry registration</button>}
    </div>}

    {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-success">{notice}</p>}
  </section>;
}
