import { AgreementStatus } from "../generated/prisma/client.js";

const amendableStatuses = new Set<AgreementStatus>([
  AgreementStatus.AWAITING_COUNTERPARTY,
  AgreementStatus.AWAITING_SIGNATURES,
  AgreementStatus.ANCHOR_FAILED,
  AgreementStatus.ANCHOR_CONFIRMED,
  AgreementStatus.REJECTED
]);

const cancellableStatuses = new Set<AgreementStatus>([
  AgreementStatus.DRAFT,
  AgreementStatus.AWAITING_COUNTERPARTY,
  AgreementStatus.AWAITING_SIGNATURES,
  AgreementStatus.ANCHOR_FAILED
]);

export function canAmendAgreement(status: AgreementStatus): boolean {
  return amendableStatuses.has(status);
}

export function canCancelAgreement(status: AgreementStatus): boolean {
  return cancellableStatuses.has(status);
}
