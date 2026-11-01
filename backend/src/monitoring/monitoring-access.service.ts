import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AgreementStatus, AnchorTransactionStatus, SignatureCollectionStatus } from "../generated/prisma/client.js";
import type { AppEnvironment } from "../config/env.schema.js";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class MonitoringAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnvironment, true>
  ) {}

  async requireActiveAgreement(context: OrganizationAuthContext, agreementId: string) {
    const agreement = await this.prisma.agreement.findUnique({
      where: { id: agreementId },
      select: {
        id: true,
        version: true,
        ownerOrganizationId: true,
        status: true,
        signatureStatus: true,
        blockchainStatus: true
      }
    });
    if (!agreement) throw new NotFoundException("Agreement not found.");

    return this.requireActiveVersion(agreement, context.organization.id);
  }

  async requireActiveSource(agreementId: string, agreementVersion: number, organizationId: string) {
    const agreement = await this.prisma.agreement.findUnique({
      where: { id: agreementId },
      select: { id: true, version: true, ownerOrganizationId: true, status: true, signatureStatus: true, blockchainStatus: true }
    });
    if (!agreement || agreement.version !== agreementVersion) throw new ConflictException("The source is bound to an inactive agreement version.");
    return this.requireActiveVersion(agreement, organizationId);
  }

  private async requireActiveVersion(
    agreement: { id: string; version: number; ownerOrganizationId: string; status: AgreementStatus; signatureStatus: SignatureCollectionStatus; blockchainStatus: AnchorTransactionStatus },
    organizationId: string
  ) {
    const [participants, selectedParticipant] = await Promise.all([
      this.prisma.agreementParticipant.findMany({ where: { agreementId: agreement.id, agreementVersion: agreement.version }, select: { organizationId: true, role: true } }),
      this.prisma.agreementParticipant.findFirst({ where: { agreementId: agreement.id, agreementVersion: agreement.version, organizationId }, select: { id: true } })
    ]);
    if (agreement.ownerOrganizationId !== organizationId && !selectedParticipant) throw new NotFoundException("Agreement not found.");
    if (agreement.status !== AgreementStatus.ANCHOR_CONFIRMED
      || agreement.signatureStatus !== SignatureCollectionStatus.COMPLETE
      || agreement.blockchainStatus !== AnchorTransactionStatus.CONFIRMED
      || participants.length !== 2) {
      throw new ConflictException("Monitoring requires a bilaterally signed agreement version confirmed on the configured network.");
    }

    const snapshot = await this.prisma.signingSnapshot.findUnique({
      where: { agreementId_version: { agreementId: agreement.id, version: agreement.version } },
      include: { anchorIntent: true, signatures: { select: { party: true } } }
    });
    if (!snapshot || snapshot.invalidatedAt || snapshot.signatureStatus !== SignatureCollectionStatus.COMPLETE
      || snapshot.signatures.length !== 2 || snapshot.anchorIntent?.status !== AnchorTransactionStatus.CONFIRMED) {
      throw new ConflictException("Monitoring requires a frozen, bilaterally signed snapshot with a confirmed anchor.");
    }

    const configuredChainId = this.config.get("BLOCKCHAIN_CHAIN_ID", { infer: true });
    if (!configuredChainId || snapshot.anchorIntent.transactionChainId !== configuredChainId) {
      throw new ConflictException("The agreement anchor is not confirmed on the currently configured network.");
    }

    return { agreement, snapshot, participants };
  }

  async requireAgreementReadAccess(context: OrganizationAuthContext, agreementId: string) {
    const agreement = await this.prisma.agreement.findUnique({ where: { id: agreementId }, select: { id: true, version: true, ownerOrganizationId: true } });
    if (!agreement) throw new NotFoundException("Agreement not found.");
    if (agreement.ownerOrganizationId === context.organization.id) return agreement;
    const participant = await this.prisma.agreementParticipant.findFirst({
      where: { agreementId, agreementVersion: agreement.version, organizationId: context.organization.id },
      select: { id: true }
    });
    if (!participant) throw new NotFoundException("Agreement not found.");
    return agreement;
  }
}
