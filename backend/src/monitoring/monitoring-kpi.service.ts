import { BadRequestException, Injectable } from "@nestjs/common";
import { KpiState, ObservationValidity } from "../generated/prisma/client.js";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { evaluateKpis, kpiAlgorithmVersion } from "./kpi-engine.js";
import { MonitoringAccessService } from "./monitoring-access.service.js";

@Injectable()
export class MonitoringKpiService {
  constructor(private readonly prisma: PrismaService, private readonly access: MonitoringAccessService) {}

  async evaluate(context: OrganizationAuthContext, agreementId: string, windowStart: string, windowEnd: string, sourceId?: string) {
    const start = new Date(windowStart);
    const end = new Date(windowEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new BadRequestException("The KPI window must have a positive duration.");
    if (end > new Date()) throw new BadRequestException("The KPI window cannot end in the future.");
    const { agreement } = await this.access.requireActiveAgreement(context, agreementId);
    const terms = await this.prisma.agreementVersion.findUniqueOrThrow({
      where: { agreementId_version: { agreementId, version: agreement.version } },
      select: { uptimeTargetPercent: true, responseTimeTargetMs: true, measurementWindowHours: true }
    });
    if (end.getTime() - start.getTime() !== terms.measurementWindowHours * 3_600_000) throw new BadRequestException("The KPI window must match the signed measurement window exactly.");
    const sources = await this.prisma.monitoringSource.findMany({
      where: { agreementId, agreementVersion: agreement.version, enabled: true, ...(sourceId ? { id: sourceId } : {}) },
      orderBy: { id: "asc" }
    });
    if (sourceId && sources.length === 0) throw new BadRequestException("No active monitoring source was found for the current agreement version.");
    const results = [];
    for (const source of sources) {
      const observations = await this.prisma.monitoringObservation.findMany({
        where: { sourceId: source.id, scheduledFor: { gt: start, lte: end } },
        select: { scheduledFor: true, validity: true, reachable: true, latencyMs: true },
        orderBy: [{ scheduledFor: "asc" }, { ingestedAt: "asc" }, { id: "asc" }]
      });
      const evaluation = evaluateKpis({
        windowStart: start,
        windowEnd: end,
        measurementIntervalSeconds: source.intervalSeconds,
        scheduleAnchor: source.createdAt,
        uptimeTargetPercent: Number(terms.uptimeTargetPercent),
        responseTimeTargetMs: terms.responseTimeTargetMs,
        observations: observations.map((observation) => ({
          scheduledFor: observation.scheduledFor,
          valid: observation.validity === ObservationValidity.VALID,
          reachable: observation.reachable,
          latencyMs: observation.latencyMs
        }))
      });
      const record = await this.prisma.kpiEvaluation.upsert({
        where: { sourceId_windowStart_windowEnd_algorithmVersion: { sourceId: source.id, windowStart: start, windowEnd: end, algorithmVersion: kpiAlgorithmVersion } },
        create: {
          organizationId: source.organizationId,
          agreementId,
          agreementVersion: agreement.version,
          sourceId: source.id,
          windowStart: start,
          windowEnd: end,
          algorithmVersion: evaluation.algorithmVersion,
          latencyStatistic: evaluation.latencyStatistic,
          expectedSamples: evaluation.expectedSamples,
          healthyObservations: evaluation.healthyObservations,
          failedObservations: evaluation.failedObservations,
          unknownObservations: evaluation.unknownObservations,
          coveragePercent: evaluation.coveragePercent,
          uptimePercent: evaluation.uptimePercent,
          meanLatencyMs: evaluation.meanLatencyMs,
          state: evaluation.state as KpiState
        },
        update: {}
      });
      // A stored window is immutable; late observations cannot change its breach decision.
      if (record.state === KpiState.BREACH_CANDIDATE) {
        await this.prisma.breachCandidate.upsert({
          where: { evaluationId: record.id },
          create: {
            organizationId: record.organizationId,
            agreementId,
            agreementVersion: agreement.version,
            evaluationId: record.id,
            state: KpiState.BREACH_CANDIDATE,
            summary: `Observed KPI values crossed the signed target in a window with ${record.coveragePercent}% coverage.`
          },
          update: {}
        });
      }
      results.push(record);
    }
    return { data: results };
  }
}
