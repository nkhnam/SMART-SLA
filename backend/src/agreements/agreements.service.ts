import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AgreementStatus, MembershipRole, Prisma } from "../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import type { AgreementListQueryDto, CreateAgreementDto, UpdateAgreementDto } from "./agreement.dto.js";
import type { OrganizationAuthContext } from "./agreement.types.js";

const latestVersion = { orderBy: { version: "desc" }, take: 1 } satisfies Prisma.Agreement$versionsArgs;

function agreementView(agreement: Prisma.AgreementGetPayload<{ include: { versions: typeof latestVersion } }>) {
  const { versions, ...record } = agreement;
  const version = versions[0];
  if (!version) throw new Error("Agreement is missing its required version snapshot.");

  return {
    id: record.id,
    reference: record.reference,
    status: record.status,
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
      ownerOrganizationId: context.organization.id,
      status: AgreementStatus.DRAFT,
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
      where: { id, ownerOrganizationId: context.organization.id },
      include: { versions: latestVersion }
    });
    if (!agreement) throw new NotFoundException("Agreement not found.");
    return agreementView(agreement);
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

  async listVersions(context: OrganizationAuthContext, id: string) {
    const agreement = await this.prisma.agreement.findFirst({
      where: { id, ownerOrganizationId: context.organization.id },
      select: { id: true }
    });
    if (!agreement) throw new NotFoundException("Agreement not found.");

    const versions = await this.prisma.agreementVersion.findMany({
      where: { agreementId: agreement.id },
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
