import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  AgreementPartyRole,
  AgreementSignatureParty,
  AgreementStatus,
  AnchorTransactionStatus,
  MembershipRole,
  SignatureCollectionStatus
} from "../generated/prisma/client.js";
import { hashTypedData } from "viem";
import { recoverTypedDataAddress } from "viem";
import { PrismaService } from "../database/prisma.service.js";
import type { OrganizationAuthContext } from "./agreement.types.js";
import { basisPointsFromPercent, canonicalizeAgreementSnapshot, agreementApprovalTypedData, serializeTypedData } from "../blockchain/agreement-hash.service.js";
import { BlockchainNetworkService } from "../blockchain/blockchain-network.service.js";
import type { AgreementSnapshotInput } from "../blockchain/agreement-hash.service.js";

const signingWindowSeconds = 7 * 24 * 60 * 60;

function requireApprovalRole(context: OrganizationAuthContext): void {
  if (context.organization.role === MembershipRole.MEMBER) {
    throw new ForbiddenException("Only organization OWNER or ADMIN members can prepare or sign an agreement.");
  }
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function canonicalInputFromPayload(payload: string): AgreementSnapshotInput {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new ServiceUnavailableException("The frozen signing snapshot is not readable.");
  }
  if (!value || typeof value !== "object") throw new ServiceUnavailableException("The frozen signing snapshot is not readable.");
  return value as AgreementSnapshotInput;
}

@Injectable()
export class AgreementSigningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchain: BlockchainNetworkService
  ) {}

  async selectSigner(context: OrganizationAuthContext, agreementId: string, authorizedSignerId: string) {
    requireApprovalRole(context);
    const agreement = await this.getAgreement(agreementId);
    if (agreement.status !== AgreementStatus.AWAITING_SIGNATURES) {
      throw new ConflictException("Signer wallets can be selected only after counterparty acceptance.");
    }
    const participant = await this.prisma.agreementParticipant.findUnique({
      where: {
        agreementId_agreementVersion_organizationId: {
          agreementId,
          agreementVersion: agreement.version,
          organizationId: context.organization.id
        }
      },
      select: { id: true }
    });
    if (!participant) throw new NotFoundException("Agreement participant not found.");
    const frozen = await this.prisma.signingSnapshot.findUnique({
      where: { agreementId_version: { agreementId, version: agreement.version } },
      select: { id: true }
    });
    if (frozen) throw new ConflictException("Signer wallets are frozen once signing preparation starts.");
    const signer = await this.prisma.authorizedSigner.findFirst({
      where: { id: authorizedSignerId, organizationId: context.organization.id, revokedAt: null },
      select: { id: true }
    });
    if (!signer) throw new NotFoundException("Authorized signer not found.");
    const selected = await this.prisma.agreementParticipant.updateMany({
      where: { id: participant.id, agreementVersion: agreement.version },
      data: { authorizedSignerId: signer.id }
    });
    if (selected.count !== 1) throw new ConflictException("The agreement participant changed. Reload it before selecting a signer.");
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: context.user.id,
        organizationId: context.organization.id,
        resourceType: "agreement",
        resourceId: agreementId,
        action: "agreement.signer.selected",
        metadata: { version: agreement.version, authorizedSignerId: signer.id }
      }
    });
    return { agreementId, version: agreement.version, selected: true };
  }

  async prepareSigning(context: OrganizationAuthContext, agreementId: string) {
    requireApprovalRole(context);
    await this.blockchain.getSigningContext();
    const agreement = await this.getAgreement(agreementId);
    if (agreement.ownerOrganizationId !== context.organization.id) throw new NotFoundException("Agreement not found.");
    if (agreement.status !== AgreementStatus.AWAITING_SIGNATURES) throw new ConflictException("The agreement is not ready for signing.");

    const existing = await this.prisma.signingSnapshot.findUnique({
      where: { agreementId_version: { agreementId, version: agreement.version } },
      include: { signatures: { select: { party: true, signerAddress: true, submittedAt: true } } }
    });
    if (existing) {
      if (existing.invalidatedAt) throw new ConflictException("This signing snapshot was invalidated; create a new agreement version.");
      return this.snapshotView(existing);
    }

    const participants = await this.prisma.agreementParticipant.findMany({
      where: { agreementId, agreementVersion: agreement.version },
      include: {
        organization: { select: { id: true, organizationType: true } },
        authorizedSigner: { select: { id: true, organizationId: true, userId: true, address: true, revokedAt: true } }
      }
    });
    const buyer = participants.find((participant) => participant.role === AgreementPartyRole.BUYER);
    const supplier = participants.find((participant) => participant.role === AgreementPartyRole.SUPPLIER);
    if (!buyer?.authorizedSigner || !supplier?.authorizedSigner) {
      throw new ConflictException("Both organizations must select a verified signer wallet before preparing the snapshot.");
    }
    if (buyer.authorizedSigner.organizationId !== buyer.organizationId || supplier.authorizedSigner.organizationId !== supplier.organizationId
      || buyer.authorizedSigner.revokedAt || supplier.authorizedSigner.revokedAt) {
      throw new ConflictException("A selected signer wallet is no longer authorized.");
    }
    const signerMemberships = await this.prisma.membership.findMany({
      where: {
        OR: [
          { userId: buyer.authorizedSigner.userId, organizationId: buyer.organizationId },
          { userId: supplier.authorizedSigner.userId, organizationId: supplier.organizationId }
        ]
      },
      select: { userId: true, organizationId: true, role: true }
    });
    if (signerMemberships.length !== 2 || signerMemberships.some((membership) => membership.role === MembershipRole.MEMBER)) {
      throw new ConflictException("Each selected signer must still be an OWNER or ADMIN member of its organization.");
    }

    const version = agreement.versions[0];
    if (!version) throw new ServiceUnavailableException("Agreement version is missing.");
    const validUntil = Math.floor(Date.now() / 1000) + signingWindowSeconds;
    const canonical = canonicalizeAgreementSnapshot({
      agreementId,
      reference: agreement.reference,
      version: agreement.version,
      buyerOrganizationId: buyer.organizationId,
      supplierOrganizationId: supplier.organizationId,
      name: version.name,
      serviceDescription: version.serviceDescription,
      uptimeTargetBasisPoints: basisPointsFromPercent(version.uptimeTargetPercent.toString()),
      responseTimeTargetMs: version.responseTimeTargetMs,
      measurementWindowHours: version.measurementWindowHours,
      exclusions: version.exclusions,
      notes: version.notes,
      buyerSigner: buyer.authorizedSigner.address,
      supplierSigner: supplier.authorizedSigner.address,
      validUntil
    });
    const snapshot = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.signingSnapshot.create({
        data: {
          agreementId,
          version: agreement.version,
          buyerOrganizationId: buyer.organizationId,
          supplierOrganizationId: supplier.organizationId,
          buyerSigner: buyer.authorizedSigner!.address,
          supplierSigner: supplier.authorizedSigner!.address,
          buyerAuthorizedSignerId: buyer.authorizedSigner!.id,
          supplierAuthorizedSignerId: supplier.authorizedSigner!.id,
          canonicalPayload: canonical.canonicalJson,
          snapshotHash: canonical.hash,
          agreementKey: canonical.key,
          nonce: BigInt(agreement.version),
          validUntil: new Date(validUntil * 1000),
          signatureStatus: SignatureCollectionStatus.PENDING
        },
        include: { signatures: { select: { party: true, signerAddress: true, submittedAt: true } } }
      });
      await transaction.agreement.updateMany({
        where: { id: agreementId, version: agreement.version, status: AgreementStatus.AWAITING_SIGNATURES },
        data: { signatureStatus: SignatureCollectionStatus.PENDING }
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "signing_snapshot",
          resourceId: created.id,
          action: "agreement.signing.prepared",
          metadata: { agreementId, version: agreement.version, snapshotHash: canonical.hash }
        }
      });
      return created;
    }).catch(async (error: unknown) => {
      if (!isUniqueConflict(error)) throw error;
      const raced = await this.prisma.signingSnapshot.findUnique({
        where: { agreementId_version: { agreementId, version: agreement.version } },
        include: { signatures: { select: { party: true, signerAddress: true, submittedAt: true } } }
      });
      if (!raced) throw error;
      return raced;
    });
    return this.snapshotView(snapshot);
  }

  async getSigning(context: OrganizationAuthContext, agreementId: string) {
    const agreement = await this.getAgreement(agreementId);
    await this.requireParticipant(context, agreement);
    const snapshot = await this.prisma.signingSnapshot.findUnique({
      where: { agreementId_version: { agreementId, version: agreement.version } },
      include: { signatures: { select: { party: true, signerAddress: true, submittedAt: true } } }
    });
    return {
      agreementId,
      version: agreement.version,
      agreementStatus: agreement.status,
      signatureStatus: agreement.signatureStatus,
      snapshot: snapshot && !snapshot.invalidatedAt ? this.snapshotView(snapshot) : null
    };
  }

  async submitSignature(context: OrganizationAuthContext, agreementId: string, signature: `0x${string}`) {
    requireApprovalRole(context);
    const agreement = await this.getAgreement(agreementId);
    const participant = await this.requireParticipant(context, agreement);
    if (agreement.status !== AgreementStatus.AWAITING_SIGNATURES) throw new ConflictException("The agreement is not collecting signatures.");
    if (!participant.authorizedSignerId || !participant.authorizedSigner || participant.authorizedSigner.revokedAt) {
      throw new ConflictException("Select an active verified signer wallet before signing.");
    }
    if (participant.authorizedSigner.userId !== context.user.id) {
      throw new ForbiddenException("Sign in as the member who verified the selected signer wallet.");
    }
    const snapshot = await this.prisma.signingSnapshot.findUnique({
      where: { agreementId_version: { agreementId, version: agreement.version } },
      include: { signatures: { select: { party: true } } }
    });
    if (!snapshot || snapshot.invalidatedAt) throw new ConflictException("The agreement has no active frozen signing snapshot.");
    if (snapshot.validUntil.getTime() <= Date.now()) throw new ConflictException("The signing authorization has expired.");
    const party = participant.role === AgreementPartyRole.BUYER ? AgreementSignatureParty.BUYER : AgreementSignatureParty.SUPPLIER;
    const expectedAddress = party === AgreementSignatureParty.BUYER ? snapshot.buyerSigner : snapshot.supplierSigner;
    if (participant.authorizedSigner.address.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new ConflictException("The selected wallet does not match the frozen snapshot.");
    }

    const { chainId, registryAddress } = await this.blockchain.getSigningContext();
    const canonical = canonicalizeAgreementSnapshot(canonicalInputFromPayload(snapshot.canonicalPayload));
    if (canonical.hash !== snapshot.snapshotHash || canonical.key !== snapshot.agreementKey) {
      throw new ServiceUnavailableException("The stored signing snapshot failed integrity verification.");
    }
    const typedData = agreementApprovalTypedData(canonical, chainId, registryAddress, snapshot.nonce, Math.floor(snapshot.validUntil.getTime() / 1000));
    const recovered = await recoverTypedDataAddress({ ...typedData, signature });
    if (recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new ForbiddenException("The submitted signature does not match the selected organization wallet.");
    }
    const digest = hashTypedData(typedData);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "SigningSnapshot" WHERE "id" = ${snapshot.id} FOR UPDATE`;
        const current = await transaction.signingSnapshot.findFirst({
          where: { id: snapshot.id, invalidatedAt: null, validUntil: { gt: new Date() } },
          select: { id: true, signatureStatus: true }
        });
        if (!current || current.signatureStatus === SignatureCollectionStatus.INVALIDATED) {
          throw new ConflictException("The signing snapshot is no longer active.");
        }
        await transaction.agreementSignature.create({
          data: {
            snapshotId: snapshot.id,
            party,
            authorizedSignerId: participant.authorizedSigner!.id,
            signerAddress: expectedAddress,
            signature,
            digest
          }
        });
        const signatureCount = await transaction.agreementSignature.count({ where: { snapshotId: snapshot.id } });
        const complete = signatureCount === 2;
        await transaction.signingSnapshot.update({
          where: { id: snapshot.id },
          data: { signatureStatus: complete ? SignatureCollectionStatus.COMPLETE : SignatureCollectionStatus.PARTIAL }
        });
        await transaction.agreement.updateMany({
          where: { id: agreementId, version: agreement.version, status: AgreementStatus.AWAITING_SIGNATURES },
          data: {
            signatureStatus: complete ? SignatureCollectionStatus.COMPLETE : SignatureCollectionStatus.PARTIAL,
            ...(complete ? { status: AgreementStatus.ANCHOR_PENDING, blockchainStatus: AnchorTransactionStatus.QUEUED } : {})
          }
        });
        if (complete) {
          await transaction.anchorIntent.create({
            data: {
              snapshotId: snapshot.id,
              idempotencyKey: snapshot.agreementKey.slice(2),
              status: AnchorTransactionStatus.QUEUED
            }
          });
        }
        await transaction.auditEvent.create({
          data: {
            actorUserId: context.user.id,
            organizationId: context.organization.id,
            resourceType: "agreement_signature",
            resourceId: snapshot.id,
            action: "agreement.signature.submitted",
            metadata: { agreementId, version: agreement.version, party, signerAddress: expectedAddress, digest }
          }
        });
        return { agreementId, version: agreement.version, party, signerAddress: expectedAddress, signatureStatus: complete ? SignatureCollectionStatus.COMPLETE : SignatureCollectionStatus.PARTIAL };
      });
    } catch (error) {
      if (isUniqueConflict(error)) throw new ConflictException("A signature for this organization was already recorded.");
      throw error;
    }
  }

  private async getAgreement(agreementId: string) {
    const agreement = await this.prisma.agreement.findUnique({
      where: { id: agreementId },
      include: { ownerOrganization: { select: { id: true, organizationType: true } } }
    });
    if (!agreement) throw new NotFoundException("Agreement not found.");
    const version = await this.prisma.agreementVersion.findUnique({
      where: { agreementId_version: { agreementId, version: agreement.version } }
    });
    return { ...agreement, versions: version ? [version] : [] };
  }

  private async requireParticipant(context: OrganizationAuthContext, agreement: Awaited<ReturnType<AgreementSigningService["getAgreement"]>>) {
    const participant = await this.prisma.agreementParticipant.findUnique({
      where: {
        agreementId_agreementVersion_organizationId: {
          agreementId: agreement.id,
          agreementVersion: agreement.version,
          organizationId: context.organization.id
        }
      },
      include: { authorizedSigner: true }
    });
    if (!participant) throw new NotFoundException("Agreement not found.");
    return participant;
  }

  private snapshotView(snapshot: {
    id: string;
    version: number;
    canonicalPayload: string;
    snapshotHash: string;
    agreementKey: string;
    nonce: bigint;
    validUntil: Date;
    signatureStatus: SignatureCollectionStatus;
    signatures: Array<{ party: AgreementSignatureParty; signerAddress: string; submittedAt: Date }>;
  }) {
    const { chainId, registryAddress } = this.blockchain.getConfiguredDomain();
    const canonical = canonicalizeAgreementSnapshot(canonicalInputFromPayload(snapshot.canonicalPayload));
    if (canonical.hash !== snapshot.snapshotHash || canonical.key !== snapshot.agreementKey) {
      throw new ServiceUnavailableException("The stored signing snapshot failed integrity verification.");
    }
    const typedData = agreementApprovalTypedData(
      canonical,
      chainId,
      registryAddress,
      snapshot.nonce,
      Math.floor(snapshot.validUntil.getTime() / 1000)
    );
    return {
      id: snapshot.id,
      version: snapshot.version,
      snapshot: canonical.snapshot,
      canonicalJson: snapshot.canonicalPayload,
      hash: snapshot.snapshotHash,
      agreementKey: snapshot.agreementKey,
      signatureStatus: snapshot.signatureStatus,
      validUntil: snapshot.validUntil,
      typedData: serializeTypedData(typedData),
      signatures: snapshot.signatures.map(({ party, signerAddress, submittedAt }) => ({ party, signerAddress, submittedAt }))
    };
  }
}
