import { encodeFunctionData, getAddress, keccak256, parseTransaction, recoverTransactionAddress, recoverTypedDataAddress, type Address, type Hex, type TransactionSerialized } from "viem";
import type { AnchorIntent, SigningSnapshot } from "../generated/prisma/client.js";
import { agreementApprovalTypedData, canonicalizeAgreementSnapshot, type AgreementSnapshotInput } from "./agreement-hash.service.js";
import { agreementRegistryAbi } from "./agreement-registry.abi.js";
import type { BlockchainNetworkService } from "./blockchain-network.service.js";

type Client = Awaited<ReturnType<BlockchainNetworkService["getSigningContext"]>>["client"];
export type ProofSnapshot = SigningSnapshot & { signatures: Array<{ party: string; signerAddress: string; signature: string }> };
export type ProofIntent = Pick<AnchorIntent, "transactionHash" | "signedTransaction" | "replacementHash" | "relayerNonce" | "relayerAddress" | "transactionChainId">;
export type AgreementProof = {
  outcome: "CONFIRMABLE" | "PENDING_RECEIPT" | "PENDING_DEPTH" | "RETRYABLE_RPC_ERROR" | "FINAL_REVERT" | "RECONCILIATION_REQUIRED";
  reason: string;
  confirmations?: number;
  requiredConfirmations: number;
  receiptBlock?: string;
  evaluatedHead?: string;
  transactionHash?: string;
  canPrepare?: boolean;
  canRecover?: boolean;
  canRebroadcast?: boolean;
};

class InvalidAgreementProof extends Error {}

export async function loadAgreementApproval(snapshot: ProofSnapshot, chainId: number, registryAddress: Address) {
  const canonical = canonicalizeAgreementSnapshot(JSON.parse(snapshot.canonicalPayload) as AgreementSnapshotInput);
  const frozen = canonical.snapshot;
  if (snapshot.invalidatedAt || snapshot.signatureStatus !== "COMPLETE"
    || canonical.hash !== snapshot.snapshotHash || canonical.key !== snapshot.agreementKey || canonical.canonicalJson !== snapshot.canonicalPayload
    || frozen.agreementId !== snapshot.agreementId || frozen.version !== snapshot.version
    || frozen.buyerOrganizationId !== snapshot.buyerOrganizationId || frozen.supplierOrganizationId !== snapshot.supplierOrganizationId
    || getAddress(frozen.buyerSigner) !== getAddress(snapshot.buyerSigner) || getAddress(frozen.supplierSigner) !== getAddress(snapshot.supplierSigner)) {
    throw new InvalidAgreementProof("snapshot_integrity_mismatch");
  }
  const typedData = agreementApprovalTypedData(canonical, chainId, registryAddress, snapshot.nonce, Math.floor(snapshot.validUntil.getTime() / 1000));
  const buyer = snapshot.signatures.find((s) => s.party === "BUYER");
  const supplier = snapshot.signatures.find((s) => s.party === "SUPPLIER");
  if (snapshot.signatures.length !== 2 || !buyer || !supplier) throw new InvalidAgreementProof("signature_party_mismatch");
  const [buyerRecovered, supplierRecovered] = await Promise.all([
    recoverTypedDataAddress({ ...typedData, signature: buyer.signature as Hex }),
    recoverTypedDataAddress({ ...typedData, signature: supplier.signature as Hex })
  ]);
  if (getAddress(buyerRecovered) !== getAddress(snapshot.buyerSigner) || getAddress(supplierRecovered) !== getAddress(snapshot.supplierSigner)
    || getAddress(buyer.signerAddress) !== getAddress(snapshot.buyerSigner) || getAddress(supplier.signerAddress) !== getAddress(snapshot.supplierSigner)) {
    throw new InvalidAgreementProof("signature_integrity_mismatch");
  }
  const args = [typedData.message, buyer.signature as Hex, supplier.signature as Hex] as const;
  return { args, calldata: encodeFunctionData({ abi: agreementRegistryAbi, functionName: "registerAgreement", args }) };
}

export async function evaluateAgreementConfirmation(
  client: Client, chainId: number, registryAddress: Address, requiredConfirmations: number,
  snapshot: ProofSnapshot, intent: ProofIntent | null
): Promise<AgreementProof> {
  const result = (outcome: AgreementProof["outcome"], reason: string, extra: Partial<AgreementProof> = {}): AgreementProof => ({ outcome, reason, requiredConfirmations, ...extra });
  let approval: Awaited<ReturnType<typeof loadAgreementApproval>>;
  try { approval = await loadAgreementApproval(snapshot, chainId, registryAddress); }
  catch (error) { return result("RECONCILIATION_REQUIRED", error instanceof InvalidAgreementProof ? error.message : "snapshot_integrity_mismatch"); }

  if (intent?.transactionHash || intent?.signedTransaction || intent?.relayerNonce !== null && intent?.relayerNonce !== undefined || intent?.replacementHash) {
    try {
      if (!intent.transactionHash || !intent.signedTransaction || intent.relayerNonce === null || !intent.relayerAddress) throw new Error();
      const serializedTransaction = intent.signedTransaction as TransactionSerialized;
      const original = parseTransaction(serializedTransaction);
      const from = await recoverTransactionAddress({ serializedTransaction });
      if (keccak256(serializedTransaction).toLowerCase() !== intent.transactionHash.toLowerCase()
        || original.chainId !== chainId || intent.transactionChainId !== chainId
        || !Number.isSafeInteger(Number(intent.relayerNonce)) || original.nonce !== Number(intent.relayerNonce)
        || getAddress(from) !== getAddress(intent.relayerAddress) || !original.to || getAddress(original.to) !== getAddress(registryAddress)
        || (original.value ?? 0n) !== 0n || original.data?.toLowerCase() !== approval.calldata.toLowerCase()) throw new Error();
    } catch { return result("RECONCILIATION_REQUIRED", "persisted_transaction_integrity_mismatch"); }
  }

  try {
    if (await client.getChainId() !== chainId) return result("RETRYABLE_RPC_ERROR", "wrong_chain_id");
    const head = await client.getBlock({ blockTag: "latest" });
    if (head.number === null || !head.hash) return result("RETRYABLE_RPC_ERROR", "head_unavailable");
    const bytecode = await client.getCode({ address: registryAddress, blockNumber: head.number });
    if (!bytecode || bytecode === "0x") return result("RECONCILIATION_REQUIRED", "registry_contract_missing");
    const [, name, version, domainChainId, verifyingContract] = await client.readContract({ address: registryAddress, abi: agreementRegistryAbi, functionName: "eip712Domain", blockNumber: head.number });
    if (name !== "SLA-DEX Agreement Registry" || version !== "1" || domainChainId !== BigInt(chainId) || getAddress(verifyingContract) !== getAddress(registryAddress)) return result("RECONCILIATION_REQUIRED", "registry_domain_mismatch");
    const record = await client.readContract({ address: registryAddress, abi: agreementRegistryAbi, functionName: "getAgreement", args: [snapshot.agreementKey as Hex], blockNumber: head.number });
    const headUnchanged = async () => (await client.getBlock({ blockNumber: head.number })).hash === head.hash;
    const stable = async (proof: AgreementProof) => {
      try { return await headUnchanged() ? proof : result("RETRYABLE_RPC_ERROR", "evaluated_head_changed"); }
      catch { return result("RETRYABLE_RPC_ERROR", "rpc_unavailable"); }
    };
    const matching = record.registeredAt !== 0n
      && record.agreementHash.toLowerCase() === snapshot.snapshotHash.toLowerCase() && record.version === BigInt(snapshot.version)
      && record.buyerOrganization.toLowerCase() === approval.args[0].buyerOrganization.toLowerCase()
      && record.supplierOrganization.toLowerCase() === approval.args[0].supplierOrganization.toLowerCase()
      && record.validUntil === approval.args[0].deadline;
    if (record.registeredAt !== 0n && !matching) return stable(result("RECONCILIATION_REQUIRED", "registry_record_mismatch"));
    if (!intent?.transactionHash) return stable(matching
      ? result("RECONCILIATION_REQUIRED", "external_registration_without_proof")
      : result("PENDING_RECEIPT", "not_registered", { canPrepare: true }));

    const hash = (intent.replacementHash ?? intent.transactionHash) as Hex;
    const receipt = await client.getTransactionReceipt({ hash }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return null;
      throw error;
    });
    const tx = await client.getTransaction({ hash }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "TransactionNotFoundError") return null;
      throw error;
    });
    if (tx && (tx.hash.toLowerCase() !== hash.toLowerCase() || tx.chainId !== chainId
      || getAddress(tx.from) !== getAddress(intent.relayerAddress!) || tx.nonce !== Number(intent.relayerNonce)
      || !tx.to || getAddress(tx.to) !== getAddress(registryAddress) || tx.value !== 0n || tx.input.toLowerCase() !== approval.calldata.toLowerCase())) {
      return stable(result("RECONCILIATION_REQUIRED", "transaction_integrity_mismatch"));
    }
    if (!receipt || !tx) return stable(result("PENDING_RECEIPT", "receipt_pending", { transactionHash: hash, canRecover: !receipt && !tx, canRebroadcast: !matching }));
    if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || !["success", "reverted"].includes(receipt.status)) return stable(result("RECONCILIATION_REQUIRED", "receipt_identity_mismatch"));
    if (tx.blockNumber !== receipt.blockNumber || tx.blockHash !== receipt.blockHash) return result("RETRYABLE_RPC_ERROR", "transaction_receipt_snapshot_mismatch");
    const canonicalBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (canonicalBlock.hash !== receipt.blockHash || receipt.blockNumber > head.number) return result("RETRYABLE_RPC_ERROR", "receipt_noncanonical");
    const confirmations = Number(head.number - receipt.blockNumber + 1n);
    const evidence = { confirmations, receiptBlock: receipt.blockNumber.toString(), evaluatedHead: head.number.toString(), transactionHash: hash };
    if (confirmations < requiredConfirmations) return stable(result("PENDING_DEPTH", "confirmations_pending", evidence));
    if (receipt.status === "reverted") return stable(matching
      ? result("RECONCILIATION_REQUIRED", "reverted_with_registration", evidence)
      : result("FINAL_REVERT", "transaction_reverted", evidence));
    if (!matching) return stable(result("RECONCILIATION_REQUIRED", "receipt_without_registration", evidence));
    return stable(result("CONFIRMABLE", "proof_complete", evidence));
  } catch { return result("RETRYABLE_RPC_ERROR", "rpc_unavailable"); }
}
