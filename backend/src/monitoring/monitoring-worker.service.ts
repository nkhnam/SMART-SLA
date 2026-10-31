import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MonitoringRunStatus, MonitoringSourceType, ObservationValidity, Prisma } from "../generated/prisma/client.js";
import { workersEnabled } from "../config/worker-runtime.js";
import { PrismaService } from "../database/prisma.service.js";
import { MonitoringAccessService } from "./monitoring-access.service.js";
import { MONITORING_HTTP_PROBE, probeHttpEndpoint } from "./http-probe.js";

const workerPollMs = 10_000;
const sourceLeaseMs = 60_000;
const batchSize = 10;

@Injectable()
export class MonitoringWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringWorkerService.name);
  private readonly workerId = randomUUID();
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MonitoringAccessService,
    @Inject(MONITORING_HTTP_PROBE) private readonly probe: typeof probeHttpEndpoint = probeHttpEndpoint
  ) {}

  onModuleInit(): void {
    if (!workersEnabled()) return;
    this.timer = setInterval(() => void this.processDueSources(), workerPollMs);
    this.timer.unref();
    void this.processDueSources();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async processDueSources(): Promise<void> {
    if (!workersEnabled() || this.running) return;
    this.running = true;
    try {
      for (let index = 0; index < batchSize; index += 1) {
        const claimed = await this.claimDueSource();
        if (!claimed) break;
        if (!claimed.runId) continue;
        try {
          await this.runSource(claimed.sourceId, claimed.runId, claimed.leaseOwner);
        } catch (error) {
          this.logger.warn(`Monitoring run ${claimed.runId} source ${claimed.sourceId} failed (${this.errorCategory(error)}).`);
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
    const leaseOwner = `${this.workerId}:${randomUUID()}`;
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string; nextRunAt: Date | null; intervalSeconds: number; enabled: boolean; leaseUntil: Date | null }>>`
        SELECT source."id", source."nextRunAt", source."intervalSeconds", source."enabled", source."leaseUntil"
        FROM "MonitoringSource" source
        WHERE source."type" = 'HTTP_PROBE'::"MonitoringSourceType"
          AND (source."leaseUntil" IS NULL OR source."leaseUntil" <= clock_timestamp())
          AND ((source."enabled" = TRUE AND source."nextRunAt" <= clock_timestamp()) OR EXISTS (
            SELECT 1 FROM "MonitoringRun" run WHERE run."sourceId" = source."id" AND run."status" = 'RUNNING'::"MonitoringRunStatus"
          ))
        ORDER BY source."nextRunAt" ASC NULLS FIRST, source."id" ASC
        FOR UPDATE OF source SKIP LOCKED
        LIMIT 1
      `;
      const source = rows[0];
      if (!source) return null;
      const [{ now }] = await transaction.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS now`;
      const recovered = await transaction.monitoringRun.updateMany({
        where: { sourceId: source.id, status: MonitoringRunStatus.RUNNING },
        data: { status: MonitoringRunStatus.FAILED, completedAt: now, errorCode: source.leaseUntil ? "lease_expired" : "lease_missing" }
      });
      if (recovered.count) this.logger.warn(`Recovering ${recovered.count} orphaned monitoring run(s) for source ${source.id} (${source.leaseUntil ? "lease_expired" : "lease_missing"}); no measurement recovered.`);
      if (!source.enabled || !source.nextRunAt || source.nextRunAt > now) {
        await transaction.monitoringSource.update({ where: { id: source.id }, data: { leaseOwner: null, leaseUntil: null } });
        return { sourceId: source.id, runId: null, leaseOwner };
      }
      const leaseUntil = new Date(now.getTime() + sourceLeaseMs);
      const run = await transaction.monitoringRun.create({
        data: { sourceId: source.id, scheduledFor: source.nextRunAt, startedAt: now }
      });
      const intervalMs = source.intervalSeconds * 1000;
      const nextStep = Math.max(1, Math.floor((now.getTime() - source.nextRunAt.getTime()) / intervalMs) + 1);
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
    } catch (error) {
      if (!(error instanceof ConflictException) && !(error instanceof NotFoundException)) throw error;
      await this.withOwnedRun(source.id, runId, leaseOwner, async (transaction, now) => {
        await transaction.monitoringRun.update({ where: { id: runId }, data: { status: MonitoringRunStatus.FAILED, completedAt: now, errorCode: "agreement_version_inactive" } });
        await transaction.monitoringSource.updateMany({
          where: { id: source.id, leaseOwner },
          data: { enabled: false, nextRunAt: null, leaseOwner: null, leaseUntil: null }
        });
      });
      return;
    }

    const probe = await this.probe(source.endpointUrl);
    const invalid = probe.errorCategory === "INVALID_RESPONSE" || probe.errorCategory === "RESPONSE_TOO_LARGE";
    await this.withOwnedRun(source.id, runId, leaseOwner, async (transaction, now, scheduledFor) => {
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
          scheduledFor,
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
          retentionUntil: new Date(now.getTime() + source.retentionDays * 86_400_000)
        }
      });
      await transaction.monitoringRun.update({ where: { id: runId }, data: { status: MonitoringRunStatus.COMPLETED, completedAt: now } });
      await transaction.monitoringSource.updateMany({
        where: { id: source.id, leaseOwner },
        data: { lastRunAt: now, leaseOwner: null, leaseUntil: null }
      });
    });
  }

  private async failRun(sourceId: string, runId: string, leaseOwner: string, errorCode: string): Promise<void> {
    await this.withOwnedRun(sourceId, runId, leaseOwner, async (transaction, now) => {
      await transaction.monitoringRun.update({ where: { id: runId }, data: { status: MonitoringRunStatus.FAILED, completedAt: now, errorCode } });
      await transaction.monitoringSource.updateMany({ where: { id: sourceId, leaseOwner }, data: { leaseOwner: null, leaseUntil: null } });
    });
  }

  private async withOwnedRun(sourceId: string, runId: string, leaseOwner: string, write: (transaction: Prisma.TransactionClient, now: Date, scheduledFor: Date) => Promise<void>): Promise<void> {
    const written = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "MonitoringSource" WHERE "id" = ${sourceId}::uuid FOR UPDATE`;
      const [owned] = await transaction.$queryRaw<Array<{ now: Date; scheduledFor: Date }>>`
        SELECT clock_timestamp() AS now, run."scheduledFor" FROM "MonitoringRun" run
        JOIN "MonitoringSource" source ON source."id" = run."sourceId"
        WHERE source."id" = ${sourceId}::uuid AND source."leaseOwner" = ${leaseOwner}
          AND source."leaseUntil" > clock_timestamp()
          AND run."id" = ${runId}::uuid AND run."status" = 'RUNNING'::"MonitoringRunStatus"
      `;
      if (!owned) return false;
      await write(transaction, owned.now, owned.scheduledFor);
      return true;
    });
    if (!written) this.logger.warn(`Monitoring run ${runId} source ${sourceId} write rejected (lease_lost_or_run_terminal).`);
  }

  private errorCategory(error: unknown): string {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return `database_${error.code}`;
    if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)) return error.name;
    return "unknown";
  }
}
