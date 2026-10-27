import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MonitoringRunStatus, MonitoringSourceType, ObservationValidity, Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { MonitoringAccessService } from "./monitoring-access.service.js";
import { probeHttpEndpoint } from "./http-probe.js";

const workerPollMs = 10_000;
const sourceLeaseMs = 60_000;
const batchSize = 10;

@Injectable()
export class MonitoringWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringWorkerService.name);
  private readonly workerId = randomUUID();
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService, private readonly access: MonitoringAccessService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.processDueSources(), workerPollMs);
    this.timer.unref();
    void this.processDueSources();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async processDueSources(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let index = 0; index < batchSize; index += 1) {
        const claimed = await this.claimDueSource();
        if (!claimed) break;
        try {
          await this.runSource(claimed.sourceId, claimed.runId, claimed.leaseOwner);
        } catch (error) {
          this.logger.warn(`Monitoring run failed (${this.errorCategory(error)}).`);
          await this.failRun(claimed.sourceId, claimed.runId, claimed.leaseOwner, this.errorCategory(error));
        }
      }
    } catch (error) {
      this.logger.error(`Monitoring worker poll failed (${this.errorCategory(error)}).`);
    } finally {
      this.running = false;
    }
  }

  private async claimDueSource() {
    const leaseOwner = this.workerId;
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string; nextRunAt: Date; intervalSeconds: number }>>`
        SELECT "id", "nextRunAt", "intervalSeconds" FROM "MonitoringSource"
        WHERE "type" = 'HTTP_PROBE'::"MonitoringSourceType"
          AND "enabled" = TRUE
          AND "nextRunAt" <= NOW()
          AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
        ORDER BY "nextRunAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const source = rows[0];
      if (!source) return null;
      const leaseUntil = new Date(Date.now() + sourceLeaseMs);
      const run = await transaction.monitoringRun.create({
        data: { sourceId: source.id, scheduledFor: source.nextRunAt, startedAt: new Date() }
      });
      const intervalMs = source.intervalSeconds * 1000;
      const nextStep = Math.max(1, Math.floor((Date.now() - source.nextRunAt.getTime()) / intervalMs) + 1);
      await transaction.monitoringSource.update({
        where: { id: source.id },
        data: {
          leaseOwner,
          leaseUntil,
          nextRunAt: new Date(source.nextRunAt.getTime() + nextStep * intervalMs)
        }
      });
      return { sourceId: source.id, runId: run.id, leaseOwner };
    });
  }

  private async runSource(sourceId: string, runId: string, leaseOwner: string): Promise<void> {
    const source = await this.prisma.monitoringSource.findFirst({ where: { id: sourceId, leaseOwner } });
    if (!source) return;
    if (!source.endpointUrl || source.type !== MonitoringSourceType.HTTP_PROBE) {
      await this.failRun(source.id, runId, leaseOwner, "source_configuration_invalid");
      return;
    }

    try {
      await this.access.requireActiveSource(source.agreementId, source.agreementVersion, source.organizationId);
    } catch {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.monitoringRun.update({ where: { id: runId }, data: { status: MonitoringRunStatus.FAILED, completedAt: new Date(), errorCode: "agreement_version_inactive" } });
        await transaction.monitoringSource.updateMany({
          where: { id: source.id, leaseOwner },
          data: { enabled: false, nextRunAt: null, leaseOwner: null, leaseUntil: null }
        });
      });
      return;
    }

    const probe = await probeHttpEndpoint(source.endpointUrl);
    const invalid = probe.errorCategory === "INVALID_RESPONSE" || probe.errorCategory === "RESPONSE_TOO_LARGE";
    await this.prisma.$transaction(async (transaction) => {
      await transaction.monitoringObservation.create({
        data: {
          organizationId: source.organizationId,
          agreementId: source.agreementId,
          agreementVersion: source.agreementVersion,
          sourceId: source.id,
          runId,
          idempotencyKey: `run:${runId}`,
          trustCategory: source.trustCategory,
          observedAt: probe.observedAt,
          scheduledFor: new Date((await transaction.monitoringRun.findUniqueOrThrow({ where: { id: runId }, select: { scheduledFor: true } })).scheduledFor),
          method: MonitoringSourceType.HTTP_PROBE,
          httpStatus: probe.httpStatus,
          latencyMs: probe.latencyMs,
          reachable: invalid ? null : probe.reachable,
          errorCategory: probe.errorCategory,
          probeDurationMs: probe.probeDurationMs,
          validity: invalid ? ObservationValidity.INVALID : ObservationValidity.VALID,
          validityReason: invalid ? probe.errorCategory : null,
          provenance: { collectionMethod: "operator_http_probe", sourceId: source.id, trustCategory: source.trustCategory } as Prisma.InputJsonObject,
          rawMetadata: { responseBodyStored: false } as Prisma.InputJsonObject,
          retentionUntil: new Date(Date.now() + source.retentionDays * 86_400_000)
        }
      });
      await transaction.monitoringRun.update({ where: { id: runId }, data: { status: MonitoringRunStatus.COMPLETED, completedAt: new Date() } });
      await transaction.monitoringSource.updateMany({
        where: { id: source.id, leaseOwner },
        data: { lastRunAt: new Date(), leaseOwner: null, leaseUntil: null }
      });
    });
  }

  private async failRun(sourceId: string, runId: string, leaseOwner: string, errorCode: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.monitoringRun.updateMany({ where: { id: runId, status: MonitoringRunStatus.RUNNING }, data: { status: MonitoringRunStatus.FAILED, completedAt: new Date(), errorCode } });
      await transaction.monitoringSource.updateMany({ where: { id: sourceId, leaseOwner }, data: { leaseOwner: null, leaseUntil: null } });
    });
  }

  private errorCategory(error: unknown): string {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return `database_${error.code}`;
    if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)) return error.name;
    return "unknown";
  }
}
