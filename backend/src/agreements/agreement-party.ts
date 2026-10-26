import { BadRequestException } from "@nestjs/common";
import type { AgreementPartyRole, OrganizationType } from "../generated/prisma/client.js";

export function resolveAgreementPartyRoles(
  ownerType: OrganizationType,
  counterpartyType: OrganizationType
): { owner: AgreementPartyRole; counterparty: AgreementPartyRole } {
  if (ownerType === "CUSTOMER" && counterpartyType === "PROVIDER") {
    return { owner: "BUYER", counterparty: "SUPPLIER" };
  }
  if (ownerType === "PROVIDER" && counterpartyType === "CUSTOMER") {
    return { owner: "SUPPLIER", counterparty: "BUYER" };
  }
  throw new BadRequestException("An agreement requires one CUSTOMER and one PROVIDER organization.");
}
