import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AgreementStatus, AnchorTransactionStatus, InvitationStatus, MembershipRole, Prisma, SignatureCollectionStatus } from "../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import type { AgreementListQueryDto, CreateAgreementDto, UpdateAgreementDto } from "./agreement.dto.js";
import type { OrganizationAuthContext } from "./agreement.types.js";
import { canAmendAgreement, canCancelAgreement } from "./agreement-lifecycle.js";

const latestVersion = { orderBy: { version: "desc" }, take: 1 } satisfies Prisma.Agreement$versionsArgs;

function agreementView(agreement: Prisma.AgreementGetPayload<{ include: { versions: typeof latestVersion } }>) {
  const { versions, ...record } = agreement;
  const version = versions[0];
  if (!version) throw new Error("Agreement is missing its required version snapshot.");

  return {
    id: record.id,
    reference: record.reference,
    ownerOrganizationId: record.ownerOrganizationId,
    status: record.status,
    signatureStatus: record.signatureStatus,
    blockchainStatus: record.blockchainStatus,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    name: version.name,
    serviceDescription: version.serviceDescription,
    counterpartyDisplayName: version.counterpartyDisplayName,
    terms: {
      uptimeTargetPercent: Number(version.uptimeTargetPercent),
      responseTimeTargetMs: version.responseTimeTargetMs,
      measurementWindowHours: version.measurementWindowHours,
      exclusions: version.exclusions,
      notes: version.notes
    }
  };
}

function versionData(input: CreateAgreementDto) {
  return {
    name: input.name.normalize("NFC").trim(),
    serviceDescription: input.serviceDescription.normalize("NFC").trim(),
    counterpartyDisplayName: input.counterpartyDisplayName.normalize("NFC").trim(),
    uptimeTargetPercent: input.terms.uptimeTargetPercent,
    responseTimeTargetMs: input.terms.responseTimeTargetMs,
    measurementWindowHours: input.terms.measurementWindowHours,
    exclusions: (input.terms.exclusions ?? []).map((item) => item.normalize("NFC").trim()),
    notes: input.terms.notes?.normalize("NFC").trim() || null
  };
}

function assertCanWrite(context: OrganizationAuthContext): void {
  if (context.organization.role === MembershipRole.MEMBER) {
    throw new ForbiddenException("Your organization role cannot change agreements.");
  }
}

@Injectable()
export class AgreementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(context: OrganizationAuthContext, query: AgreementListQueryDto) {
    const createdAt = query.createdAfter || query.createdBefore
      ? {
          ...(query.createdAfter ? { gte: new Date(query.createdAfter) } : {}),
          ...(query.createdBefore ? { lte: new Date(query.createdBefore) } : {})
        }
      : undefined;
    if (query.createdAfter && query.createdBefore && new Date(query.createdAfter).getTime() > new Date(query.createdBefore).getTime()) {
      throw new BadRequestException("createdAfter must be earlier than or equal to createdBefore.");
    }
    const where = {
      OR: [
        { ownerOrganizationId: context.organization.id },
        { participants: { some: { organizationId: context.organization.id } } }
      ],
      ...(createdAt ? { createdAt } : {})
    };
    const orderBy = query.sort === "createdAt"
      ? { createdAt: query.order }
      : { updatedAt: query.order };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.agreement.count({ where }),
      this.prisma.agreement.findMany({
        where,
        include: { versions: latestVersion },
        orderBy: [{ ...orderBy }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      })
    ]);

    return {
      data: rows.map(agreementView),
      page: query.page,
      pageSize: query.pageSize,
      total
    };
  }

  async create(context: OrganizationAuthContext, input: CreateAgreementDto) {
    assertCanWrite(context);
    const id = randomUUID();
    const reference = `SLA-${id.replaceAll("-", "").slice(0, 24).toUpperCase()}`;
    const agreement = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.agreement.create({
        data: {
          id,
          reference,
          ownerOrganizationId: context.organization.id,
          createdByUserId: context.user.id,
          status: AgreementStatus.DRAFT,
          version: 1,
          versions: { create: { ...versionData(input), version: 1, actorUserId: context.user.id } }
        },
        include: { versions: latestVersion }
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "agreement",
          resourceId: created.id,
          action: "agreement.draft.created",
          metadata: { version: 1 }
        }
      });
      return created;
    });
    return agreementView(agreement);
  }

  async get(context: OrganizationAuthContext, id: string) {
    const agreement = await this.prisma.agreement.findFirst({
      where: {
        id,
        OR: [
          { ownerOrganizationId: context.organization.id },
          { participants: { some: { organizationId: context.organization.id } } }
        ]
      },
      include: {
        versions: latestVersion,
        participants: {
          include: { organization: { select: { id: true, name: true, organizationType: true } } },
          orderBy: { acceptedAt: "asc" }
        }
      }
    });
    if (!agreement) throw new NotFoundException("Agreement not found.");
    const parties = agreement.participants.filter((participant) => participant.agreementVersion === agreement.version);
    return {
      ...agreementView(agreement),
      ownerOrganizationId: agreement.ownerOrganizationId,
      signatureStatus: agreement.signatureStatus,
      blockchainStatus: agreement.blockchainStatus,
      parties: parties.map(({ organization, role, acceptedAt }) => ({ organization, role, acceptedAt }))
    };
  }

  async update(context: OrganizationAuthContext, id: string, input: UpdateAgreementDto) {
    assertCanWrite(context);
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.agreement.findFirst({
        where: { id, ownerOrganizationId: context.organization.id },
        select: { id: true, version: true, status: true }
      });
      if (!current) throw new NotFoundException("Agreement not found.");
      if (current.status !== AgreementStatus.DRAFT) {
        throw new ConflictException("Only draft agreements can be changed.");
      }
      if (current.version !== input.expectedVersion) {
        throw new ConflictException("This draft changed since you opened it. Reload the latest version before saving.");
      }

      const nextVersion = input.expectedVersion + 1;
      const updated = await transaction.agreement.updateMany({
        where: {
          id,
          ownerOrganizationId: context.organization.id,
          status: AgreementStatus.DRAFT,
          version: input.expectedVersion
        },
        data: { version: { increment: 1 } }
      });
      if (updated.count !== 1) {
        throw new ConflictException("This draft changed since you opened it. Reload the latest version before saving.");
      }

      await transaction.agreementVersion.create({
        data: {
          agreementId: id,
          ...versionData(input),
          version: nextVersion,
          actorUserId: context.user.id
        }
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "agreement",
          resourceId: id,
          action: "agreement.draft.revised",
          metadata: { version: nextVersion }
        }
      });

      const agreement = await transaction.agreement.findFirstOrThrow({
        where: { id, ownerOrganizationId: context.organization.id },
        include: { versions: latestVersion }
      });
      return agreementView(agreement);
    });
  }

  async amend(context: OrganizationAuthContext, id: string, input: UpdateAgreementDto) {
    assertCanWrite(context);
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.agreement.findFirst({
        where: { id, ownerOrganizationId: context.organization.id },
        select: { id: true, version: true, status: true }
      });
      if (!current) throw new NotFoundException("Agreement not found.");
      if (current.status === AgreementStatus.DRAFT) throw new ConflictException("Use draft editing while the agreement is still a draft.");
      if (!canAmendAgreement(current.status)) throw new ConflictException("This agreement cannot be amended while blockchain registration is unresolved.");
      if (current.version !== input.expectedVersion) {
        throw new ConflictException("This agreement changed since you opened it. Reload the latest version before amending.");
      }

      const snapshot = await transaction.signingSnapshot.findUnique({
        where: { agreementId_version: { agreementId: id, version: current.version } },
        include: { anchorIntent: { select: { status: true } } }
      });
      const unresolvedAnchorStatuses = new Set<AnchorTransactionStatus>([
        AnchorTransactionStatus.SUBMISSION_UNCERTAIN,
        AnchorTransactionStatus.SUBMITTED,
        AnchorTransactionStatus.REPLACED,
        AnchorTransactionStatus.RECONCILIATION_REQUIRED
      ]);
      if (snapshot?.anchorIntent && unresolvedAnchorStatuses.has(snapshot.anchorIntent.status)) {
        throw new ConflictException("The previous registration still needs reconciliation; it cannot be amended yet.");
      }

      const nextVersion = current.version + 1;
      const updated = await transaction.agreement.updateMany({
        where: { id, ownerOrganizationId: context.organization.id, version: current.version, status: current.status },
        data: {
          version: { increment: 1 },
          status: AgreementStatus.DRAFT,
          signatureStatus: SignatureCollectionStatus.NOT_STARTED,
          blockchainStatus: AnchorTransactionStatus.NOT_QUEUED
        }
      });
      if (updated.count !== 1) throw new ConflictException("This agreement changed while it was being amended.");

      await transaction.agreementVersion.create({
        data: {
          agreementId: id,
          ...versionData(input),
          version: nextVersion,
          actorUserId: context.user.id
        }
      });
      await transaction.agreementInvitation.updateMany({
        where: { agreementId: id, agreementVersion: current.version, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.WITHDRAWN }
      });
      await transaction.agreementParticipant.deleteMany({
        where: { agreementId: id, agreementVersion: current.version }
      });
      if (snapshot && current.status !== AgreementStatus.ANCHOR_CONFIRMED) {
        await transaction.signingSnapshot.update({
          where: { id: snapshot.id },
          data: { signatureStatus: SignatureCollectionStatus.INVALIDATED, invalidatedAt: new Date() }
        });
      }
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "agreement",
          resourceId: id,
          action: "agreement.amended",
          metadata: { previousVersion: current.version, version: nextVersion, previousStatus: current.status }
        }
      });

      return transaction.agreement.findFirstOrThrow({
        where: { id, ownerOrganizationId: context.organization.id },
        include: { versions: latestVersion }
      }).then(agreementView);
    });
  }

  async cancel(context: OrganizationAuthContext, id: string, expectedVersion: number) {
    assertCanWrite(context);
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.agreement.findFirst({
        where: { id, ownerOrganizationId: context.organization.id },
        select: { id: true, version: true, status: true }
      });
      if (!current) throw new NotFoundException("Agreement not found.");
      if (current.version !== expectedVersion) throw new ConflictException("This agreement changed. Reload it before cancelling.");
      if (!canCancelAgreement(current.status)) throw new ConflictException("A pending or confirmed blockchain registration cannot be cancelled.");

      const changed = await transaction.agreement.updateMany({
        where: { id, ownerOrganizationId: context.organization.id, version: expectedVersion, status: current.status },
        data: { status: AgreementStatus.CANCELLED, signatureStatus: SignatureCollectionStatus.INVALIDATED }
      });
      if (changed.count !== 1) throw new ConflictException("This agreement changed while it was being cancelled.");
      await transaction.agreementInvitation.updateMany({
        where: { agreementId: id, agreementVersion: expectedVersion, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.WITHDRAWN }
      });
      await transaction.signingSnapshot.updateMany({
        where: { agreementId: id, version: expectedVersion, invalidatedAt: null },
        data: { signatureStatus: SignatureCollectionStatus.INVALIDATED, invalidatedAt: new Date() }
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "agreement",
          resourceId: id,
          action: "agreement.cancelled",
          metadata: { version: expectedVersion, previousStatus: current.status }
        }
      });
      return transaction.agreement.findFirstOrThrow({
        where: { id, ownerOrganizationId: context.organization.id },
        include: { versions: latestVersion }
      }).then(agreementView);
    });
  }

  async listVersions(context: OrganizationAuthContext, id: string) {
    const agreement = await this.prisma.agreement.findFirst({
      where: {
        id,
        OR: [
          { ownerOrganizationId: context.organization.id },
          { participants: { some: { organizationId: context.organization.id } } }
        ]
      },
      select: { id: true, version: true, ownerOrganizationId: true }
    });
    if (!agreement) throw new NotFoundException("Agreement not found.");

    const versions = await this.prisma.agreementVersion.findMany({
      where: {
        agreementId: agreement.id,
        ...(agreement.ownerOrganizationId === context.organization.id ? {} : { version: agreement.version })
      },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: { version: "desc" }
    });
    return versions.map((version) => ({
      version: version.version,
      actor: version.actor,
      createdAt: version.createdAt,
      name: version.name,
      serviceDescription: version.serviceDescription,
      counterpartyDisplayName: version.counterpartyDisplayName,
      terms: {
        uptimeTargetPercent: Number(version.uptimeTargetPercent),
        responseTimeTargetMs: version.responseTimeTargetMs,
        measurementWindowHours: version.measurementWindowHours,
        exclusions: version.exclusions,
        notes: version.notes
      }
    }));
  }
}
