export type AnchorRecoveryObservation = {
  registry: "missing" | "matching" | "mismatch";
  receipt: "missing" | "success" | "reverted";
  transaction: "missing" | "present";
  pendingNonce: bigint;
  relayerNonce: bigint;
};

export type AnchorRecoveryAction = "MANUAL_RECONCILIATION" | "WAIT_FOR_RECEIPT" | "REBROADCAST_SAME_TRANSACTION" | "EVALUATE_PROOF";

export function resolveAnchorRecovery(observation: AnchorRecoveryObservation): AnchorRecoveryAction {
  if (observation.registry === "mismatch") return "MANUAL_RECONCILIATION";
  if (observation.registry === "matching" || observation.receipt !== "missing") return "EVALUATE_PROOF";
  if (observation.transaction === "present") return "WAIT_FOR_RECEIPT";
  if (observation.pendingNonce > observation.relayerNonce) return "MANUAL_RECONCILIATION";
  return "REBROADCAST_SAME_TRANSACTION";
}
