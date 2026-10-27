export type AnchorRecoveryObservation = {
  registry: "missing" | "matching" | "mismatch";
  receipt: "missing" | "success" | "reverted";
  transaction: "missing" | "present";
  pendingNonce: bigint;
  relayerNonce: bigint;
};

export type AnchorRecoveryAction = "CONFIRM" | "FAILED" | "MANUAL_RECONCILIATION" | "WAIT_FOR_RECEIPT" | "REBROADCAST_SAME_TRANSACTION" | "VERIFY_REGISTRY";

export function resolveAnchorRecovery(observation: AnchorRecoveryObservation): AnchorRecoveryAction {
  if (observation.registry === "matching") return "CONFIRM";
  if (observation.registry === "mismatch") return "MANUAL_RECONCILIATION";
  if (observation.receipt === "reverted") return "FAILED";
  if (observation.receipt === "success") return "VERIFY_REGISTRY";
  if (observation.transaction === "present") return "WAIT_FOR_RECEIPT";
  if (observation.pendingNonce > observation.relayerNonce) return "MANUAL_RECONCILIATION";
  return "REBROADCAST_SAME_TRANSACTION";
}
