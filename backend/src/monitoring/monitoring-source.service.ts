import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { MembershipRole, MonitoringSourceType, MonitoringTrustCategory, ObservationValidity, Prisma } from "../generated/prisma/client.js";
import type { AppEnvironment } from "../config/env.schema.js";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { createWebhookSecret, decryptWebhookSecret, encryptWebhookSecret, verifyWebhookSignature, type WebhookMetadata } from "./webhook-security.js";
import { MonitoringAccessService } from "./monitoring-access.service.js";
import { validateEndpointUrl } from "./ssrf.js";
import type { CreateMonitoringSourceDto, MonitoringObservationQueryDto, UpdateMonitoringSourceDto, WebhookObservationDto } from "./monitoring.dto.js";

const maximumSourcesPerOrganization = 20;
const webhookBodyLimitBytes = 65_536;
const webhookFreshnessSeconds = 300;

@Injectable()
export class MonitoringSourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnvironment, true>,
    private readonly access: MonitoringAccessService
  ) {}

  async listSources(context: OrganizationAuthContext, agreementId: string) {
    const { agreement } = await this.access.requireActiveAgreement(context, agreementId);
    const sources = await this.prisma.monitoringSource.findMany({
      where: { agreementId, agreementVersion: agreement.version },
      orderBy: { createdAt: "asc" }
    });
    return sources.map((source) => this.sourceView(source, context.organization));
  }

  async createSource(context: OrganizationAuthContext, agreementId: string, input: CreateMonitoringSourceDto) {
    this.requireSourceAdministrator(context);
    const { agreement } = await this.access.requireActiveAgreement(context, agreementId);
    if (!input.name.trim()) throw new BadRequestException("A monitoring source name is required.");
    if (input.type === MonitoringSourceType.HTTP_PROBE && !input.endpointUrl) {
      throw new BadRequestException("An HTTP probe requires an endpoint URL.");
    }
    if (input.type === MonitoringSourceType.SIGNED_WEBHOOK && input.endpointUrl) {
      throw new BadRequestException("A signed webhook source does not configure an endpoint URL.");
    }
    const endpointUrl = input.endpointUrl ? this.endpointUrl(input.endpointUrl) : null;
    const secret = input.type === MonitoringSourceType.SIGNED_WEBHOOK ? createWebhookSecret() : null;
    const encryptionKey = secret ? this.getEncryptionKey() : null;
    const trustCategory = input.type === MonitoringSourceType.SIGNED_WEBHOOK
      ? MonitoringTrustCategory.PROVIDER_REPORTED
      : this.config.getOrThrow("NODE_ENV", { infer: true }) === "test"
        ? MonitoringTrustCategory.SYNTHETIC_TEST
        : MonitoringTrustCategory.OPERATOR_COLLECTED;
    const now = new Date();
    const source = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${context.organization.id}))`;
      const sourceCount = await transaction.monitoringSource.count({ where: { organizationId: context.organization.id, enabled: true } });
      if (sourceCount >= maximumSourcesPerOrganization) throw new ConflictException("The organization has reached its active monitoring source limit.");
      const created = await transaction.monitoringSource.create({
        data: {
          organizationId: context.organization.id,
          agreementId,
          agreementVersion: agreement.version,
          createdByUserId: context.user.id,
          type: input.type,
          trustCategory,
          name: input.name.normalize("NFC").trim(),
          endpointUrl,
          encryptedWebhookSecret: secret && encryptionKey ? encryptWebhookSecret(secret, encryptionKey) : null,
          intervalSeconds: input.intervalSeconds,
          retentionDays: input.retentionDays ?? 90,
          createdAt: now,
          nextRunAt: input.type === MonitoringSourceType.HTTP_PROBE ? now : null
        }
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "monitoring_source",
          resourceId: created.id,
          action: "monitoring.source.created",
          metadata: { agreementId, agreementVersion: agreement.version, type: input.type, trustCategory }
        }
      });
      return created;
    });

    return { ...this.sourceView(source, context.organization), webhookSecret: secret };
  }

  async updateSource(context: OrganizationAuthContext, agreementId: string, sourceId: string, input: UpdateMonitoringSourceDto) {
    this.requireSourceAdministrator(context);
    const { agreement } = await this.access.requireActiveAgreement(context, agreementId);
    const source = await this.prisma.monitoringSource.findFirst({
      where: { id: sourceId, agreementId, agreementVersion: agreement.version, organizationId: context.organization.id }
    });
    if (!source) throw new NotFoundException("Monitoring source not found.");
    if (input.intervalSeconds !== undefined && input.intervalSeconds !== source.intervalSeconds) {
      const observations = await this.prisma.monitoringObservation.count({ where: { sourceId: source.id } });
      if (observations > 0) throw new ConflictException("A source interval cannot change after observations exist; create a new source to preserve its sampling history.");
    }
    if (input.endpointUrl !== undefined && source.type !== MonitoringSourceType.HTTP_PROBE) {
      throw new BadRequestException("Only HTTP probe sources have an endpoint URL.");
    }
    if (input.rotateWebhookSecret && source.type !== MonitoringSourceType.SIGNED_WEBHOOK) {
      throw new BadRequestException("Only signed webhook sources have a secret to rotate.");
    }

    const secret = input.rotateWebhookSecret ? createWebhookSecret() : null;
    const encryptionKey = secret ? this.getEncryptionKey() : null;
    const updated = await this.prisma.$transaction(async (transaction) => {
      if (input.enabled === true) {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${context.organization.id}))`;
        const otherActiveSources = await transaction.monitoringSource.count({ where: { organizationId: context.organization.id, enabled: true, id: { not: source.id } } });
        if (otherActiveSources >= maximumSourcesPerOrganization) throw new ConflictException("The organization has reached its active monitoring source limit.");
      }
      const next = await transaction.monitoringSource.update({
        where: { id: source.id },
        data: {
          ...(input.name !== undefined ? { name: input.name.normalize("NFC").trim() } : {}),
          ...(input.endpointUrl !== undefined ? { endpointUrl: this.endpointUrl(input.endpointUrl) } : {}),
          ...(input.intervalSeconds !== undefined ? { intervalSeconds: input.intervalSeconds } : {}),
          ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...((input.enabled !== undefined || input.intervalSeconds !== undefined)
            ? { nextRunAt: (input.enabled ?? source.enabled) && source.type === MonitoringSourceType.HTTP_PROBE ? nextScheduledAt(source.createdAt, input.intervalSeconds ?? source.intervalSeconds, new Date()) : null }
            : {}),
          ...(secret && encryptionKey ? { encryptedWebhookSecret: encryptWebhookSecret(secret, encryptionKey) } : {})
        }
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "monitoring_source",
          resourceId: source.id,
          action: "monitoring.source.updated",
          metadata: { agreementId, agreementVersion: agreement.version, changed: Object.keys(input).filter((key) => key !== "rotateWebhookSecret"), secretRotated: Boolean(secret) }
        }
      });
      return next;
    });
    return { ...this.sourceView(updated, context.organization), webhookSecret: secret };
  }

  async listObservations(context: OrganizationAuthContext, agreementId: string, query: MonitoringObservationQueryDto) {
    await this.access.requireAgreementReadAccess(context, agreementId);
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from.getTime() >= to.getTime()) throw new BadRequestException("from must be earlier than to.");
    if (query.sourceId) {
      const source = await this.prisma.monitoringSource.findFirst({ where: { id: query.sourceId, agreementId }, select: { id: true } });
      if (!source) throw new NotFoundException("Monitoring source not found.");
    }
    const where = {
      agreementId,
      ...(query.sourceId ? { sourceId: query.sourceId } : {}),
      ...(from || to ? { observedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {})
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.monitoringObservation.count({ where }),
      this.prisma.monitoringObservation.findMany({
        where,
        select: {
          id: true, agreementVersion: true, trustCategory: true, observedAt: true, ingestedAt: true, scheduledFor: true, method: true,
          httpStatus: true, latencyMs: true, reachable: true, errorCategory: true, probeDurationMs: true, collectionRegion: true,
          agentIdentity: true, validity: true, validityReason: true, provenance: true,
          source: { select: { id: true, name: true, type: true, trustCategory: true } }
        },
        orderBy: [{ observedAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      })
    ]);
    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async listEvaluations(context: OrganizationAuthContext, agreementId: string) {
    await this.access.requireAgreementReadAccess(context, agreementId);
    return this.prisma.kpiEvaluation.findMany({
      where: { agreementId },
      include: { source: { select: { id: true, name: true, trustCategory: true } } },
      orderBy: [{ windowEnd: "desc" }, { sourceId: "asc" }],
      take: 200
    });
  }

  async listBreachCandidates(context: OrganizationAuthContext, agreementId: string) {
    await this.access.requireAgreementReadAccess(context, agreementId);
    return this.prisma.breachCandidate.findMany({
      where: { agreementId },
      include: { evaluation: { include: { source: { select: { id: true, name: true, trustCategory: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 200
    });
  }

  async ingestWebhook(sourceId: string, body: WebhookObservationDto, rawBody: Buffer, metadata: WebhookMetadata, signature: string) {
    if (rawBody.byteLength > webhookBodyLimitBytes) throw new BadRequestException("Webhook request exceeds the maximum size.");
    const source = await this.prisma.monitoringSource.findUnique({ where: { id: sourceId } });
    if (!source || source.type !== MonitoringSourceType.SIGNED_WEBHOOK || !source.enabled || !source.encryptedWebhookSecret) {
      throw new NotFoundException("Monitoring source not found.");
    }
    await this.access.requireActiveSource(source.agreementId, source.agreementVersion, source.organizationId);
    const key = this.getEncryptionKey();
    const secret = decryptWebhookSecret(source.encryptedWebhookSecret, key);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!verifyWebhookSignature(secret, metadata, rawBody, signature, nowSeconds, webhookFreshnessSeconds)) {
      throw new ForbiddenException("Webhook authentication failed.");
    }
    const observedAt = new Date(body.observedAt);
    if (Math.abs(observedAt.getTime() / 1000 - Number(metadata.timestamp)) > webhookFreshnessSeconds) {
      throw new BadRequestException("Observation timestamp does not match the signed timestamp window.");
    }

    const bodyDigest = createHash("sha256").update(rawBody).digest("hex");
    const existing = await this.prisma.monitoringObservation.findUnique({
      where: { sourceId_idempotencyKey: { sourceId, idempotencyKey: metadata.eventId } },
      select: { id: true, rawMetadata: true }
    });
    if (existing) {
      const existingMetadata = existing.rawMetadata as { bodyDigest?: unknown };
      if (existingMetadata.bodyDigest !== bodyDigest) throw new ConflictException("Webhook event ID was already used with different content.");
      return { accepted: true, duplicate: true, observationId: existing.id };
    }

    try {
      const observation = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.monitoringObservation.create({
          data: {
            organizationId: source.organizationId,
            agreementId: source.agreementId,
            agreementVersion: source.agreementVersion,
            sourceId: source.id,
            idempotencyKey: metadata.eventId,
            webhookNonce: metadata.nonce,
            trustCategory: MonitoringTrustCategory.PROVIDER_REPORTED,
            observedAt,
            scheduledFor: observedAt,
            method: MonitoringSourceType.SIGNED_WEBHOOK,
            httpStatus: body.httpStatus ?? null,
            latencyMs: body.latencyMs ?? null,
            reachable: body.reachable,
            collectionRegion: body.collectionRegion?.normalize("NFC").slice(0, 80) ?? null,
            agentIdentity: body.agentIdentity?.normalize("NFC").slice(0, 120) ?? null,
            validity: ObservationValidity.VALID,
            provenance: { eventId: metadata.eventId, signedTimestamp: metadata.timestamp, sourceId: source.id } as Prisma.InputJsonObject,
            rawMetadata: { bodyDigest, providerMetadata: (body.providerMetadata ?? {}) as Prisma.InputJsonValue } as Prisma.InputJsonObject,
            retentionUntil: new Date(Date.now() + source.retentionDays * 86_400_000)
          }
        });
        await transaction.monitoringSource.update({ where: { id: source.id }, data: { lastRunAt: new Date() } });
        return created;
      });
      return { accepted: true, duplicate: false, observationId: observation.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Webhook nonce or event ID has already been used.");
      }
      throw error;
    }
  }

  private sourceView(source: {
    id: string; organizationId: string; type: MonitoringSourceType; trustCategory: MonitoringTrustCategory; name: string;
    endpointUrl: string | null; intervalSeconds: number; retentionDays: number; enabled: boolean; nextRunAt: Date | null;
    lastRunAt: Date | null; createdAt: Date;
  }, organization: OrganizationAuthContext["organization"]) {
    return {
      id: source.id,
      type: source.type,
      trustCategory: source.trustCategory,
      name: source.name,
      endpointUrl: source.organizationId === organization.id ? source.endpointUrl : null,
      canManage: source.organizationId === organization.id && organization.role !== MembershipRole.MEMBER,
      intervalSeconds: source.intervalSeconds,
      retentionDays: source.retentionDays,
      enabled: source.enabled,
      nextRunAt: source.nextRunAt,
      lastRunAt: source.lastRunAt,
      createdAt: source.createdAt
    };
  }

  private requireSourceAdministrator(context: OrganizationAuthContext): void {
    if (context.organization.role === MembershipRole.MEMBER) throw new ForbiddenException("Only an organization OWNER or ADMIN can configure monitoring sources.");
  }

  private endpointUrl(value: string): string {
    try {
      return validateEndpointUrl(value).toString();
    } catch (error) {
      if (error instanceof TypeError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private getEncryptionKey(): Buffer {
    const value = this.config.get("MONITORING_SECRET_ENCRYPTION_KEY", { infer: true });
    if (!value) throw new ServiceUnavailableException("Webhook secret encryption is not configured.");
    return Buffer.from(value, "hex");
  }
}

function nextScheduledAt(anchor: Date, intervalSeconds: number, now: Date): Date {
  const intervalMs = intervalSeconds * 1000;
  const steps = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / intervalMs) + 1);
  return new Date(anchor.getTime() + steps * intervalMs);
}
