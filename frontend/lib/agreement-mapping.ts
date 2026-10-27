import type { LiveAgreement } from "./live-api";

export type AgreementListItem = {
  id: string;
  reference: string;
  name: string;
  counterparty: string;
  uptimeTarget: string;
  responseTarget: string;
  versionLabel: string;
  updatedAt: string;
};

export function toAgreementListItem(agreement: LiveAgreement): AgreementListItem {
  return {
    id: agreement.id,
    reference: agreement.reference,
    name: agreement.name,
    counterparty: agreement.counterpartyDisplayName,
    uptimeTarget: `${agreement.terms.uptimeTargetPercent}%`,
    responseTarget: `${agreement.terms.responseTimeTargetMs} ms`,
    versionLabel: `v${agreement.version}`,
    updatedAt: agreement.updatedAt
  };
}
