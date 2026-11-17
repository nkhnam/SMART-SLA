import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { keccak256, toBytes } from "viem";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { buildMerkleEntries, canonicalJson, evidenceSchemaVersion, verifyEvidencePackage } from "./evidence-protocol.js";
import { MonitoringAccessService } from "./monitoring-access.service.js";
import { evaluateKpis, kpiAlgorithmVersion } from "./kpi-engine.js";

@Injectable()
export class MonitoringEvidenceService {
  constructor(private readonly prisma: PrismaService, private readonly access: MonitoringAccessService) {}

  async build(context: OrganizationAuthContext, agreementId: string, windowStart: string, windowEnd: string) {
    const start = new Date(windowStart);
    const end = new Date(windowEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end > new Date()) {
      throw new BadRequestException("Evidence window must be a past interval with a positive duration.");
    }
    const { agreement } = await this.access.requireActiveAgreement(context, agreementId);
    const existing = await this.prisma.evidenceBatch.findUnique({
      where: { agreementId_agreementVersion_windowStart_windowEnd: { agreementId, agreementVersion: agreement.version, windowStart: start, windowEnd: end } },
      select: { id: true, agreementVersion: true, windowStart: true, windowEnd: true, schemaVersion: true, algorithmVersion: true, merkleRoot: true, batchDigest: true, observationCount: true, createdAt: true, anchorIntent: { select: { status: true, transactionChainId: true, transactionHash: true } } }
    });
    if (existing) return { ...existing, verification: { algorithm: "keccak256-prefixed-merkle-v1", root: existing.merkleRoot, independentlyVerifiable: false } };
    const observationRows = await this.prisma.monitoringObservation.findMany({
      where: { agreementId, agreementVersion: agreement.version, scheduledFor: { gt: start, lte: end } },
      orderBy: [{ scheduledFor: "asc" }, { ingestedAt: "asc" }, { id: "asc" }],
      select: {
        id: true, agreementVersion: true, sourceId: true, trustCategory: true, observedAt: true, ingestedAt: true,
        scheduledFor: true, method: true, httpStatus: true, latencyMs: true, reachable: true, errorCategory: true,
        probeDurationMs: true, collectionRegion: true, agentIdentity: true, validity: true, validityReason: true, provenance: true,
        source: { select: { name: true, type: true, trustCategory: true } }
      }
    });
    const [snapshot, versionTerms] = await Promise.all([
      this.prisma.signingSnapshot.findUniqueOrThrow({ where: { agreementId_version: { agreementId, version: agreement.version } }, select: { snapshotHash: true } }),
      this.prisma.agreementVersion.findUniqueOrThrow({ where: { agreementId_version: { agreementId, version: agreement.version } }, select: { measurementWindowHours: true, uptimeTargetPercent: true, responseTimeTargetMs: true } })
    ]);
    if (end.getTime() - start.getTime() !== versionTerms.measurementWindowHours * 3_600_000) throw new BadRequestException("The evidence window must match the signed measurement window exactly.");
    const evaluations = await this.prisma.kpiEvaluation.findMany({
      where: { agreementId, agreementVersion: agreement.version, windowStart: start, windowEnd: end },
      select: { sourceId: true, windowStart: true, windowEnd: true, algorithmVersion: true, latencyStatistic: true, expectedSamples: true, healthyObservations: true, failedObservations: true, unknownObservations: true, coveragePercent: true, uptimePercent: true, meanLatencyMs: true, state: true, breachCandidate: { select: { state: true } }, source: { select: { createdAt: true, intervalSeconds: true } } },
      orderBy: [{ sourceId: "asc" }, { windowStart: "asc" }]
    });
    const metricFields = ["expectedSamples", "healthyObservations", "failedObservations", "unknownObservations", "coveragePercent", "uptimePercent", "meanLatencyMs"] as const;
    for (const evaluation of evaluations) {
      const recomputed = evaluateKpis({
        windowStart: start,
        windowEnd: end,
        measurementIntervalSeconds: evaluation.source.intervalSeconds,
        scheduleAnchor: evaluation.source.createdAt,
        uptimeTargetPercent: Number(versionTerms.uptimeTargetPercent),
        responseTimeTargetMs: versionTerms.responseTimeTargetMs,
        observations: observationRows.filter((row) => row.sourceId === evaluation.sourceId).map((row) => ({
          scheduledFor: row.scheduledFor,
          valid: row.validity === "VALID",
          reachable: row.reachable,
          latencyMs: row.latencyMs
        }))
      });
      const changed = evaluation.algorithmVersion !== recomputed.algorithmVersion
        || evaluation.latencyStatistic !== recomputed.latencyStatistic
        || evaluation.state !== recomputed.state
        || metricFields.some((field) => recomputed[field] === null ? evaluation[field] !== null : evaluation[field] === null || Number(evaluation[field]) !== recomputed[field])
        || (evaluation.breachCandidate !== null && (evaluation.state !== "BREACH_CANDIDATE" || evaluation.breachCandidate.state !== "BREACH_CANDIDATE"));
      if (changed) throw new ConflictException("The selected observations cannot reproduce a frozen KPI evaluation. Use a different completed window or restore its original data.");
    }
    if (observationRows.length === 0) throw new BadRequestException("No observations exist in this evidence window.");
    // Protocol v1 orders Merkle records by observedAt/id; KPI input selection uses slot/ingestion order.
    const observations = [...observationRows].sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime()
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)).map((row) => ({
      ...row,
      observedAt: row.observedAt.toISOString(),
      ingestedAt: row.ingestedAt.toISOString(),
      scheduledFor: row.scheduledFor.toISOString()
    }));
    const { root, entries } = buildMerkleEntries(observations);
    const manifestBase = {
      schemaVersion: evidenceSchemaVersion,
      agreementId,
      agreementVersion: observations[0]!.agreementVersion,
      signingSnapshotHash: snapshot.snapshotHash,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      algorithmVersion: kpiAlgorithmVersion,
      observationCount: observations.length,
      kpiEvaluations: evaluations.map((item) => ({
        sourceId: item.sourceId, windowStart: item.windowStart.toISOString(), windowEnd: item.windowEnd.toISOString(),
        algorithmVersion: item.algorithmVersion, latencyStatistic: item.latencyStatistic,
        expectedSamples: item.expectedSamples, healthyObservations: item.healthyObservations, failedObservations: item.failedObservations, unknownObservations: item.unknownObservations,
        coveragePercent: item.coveragePercent.toString(), uptimePercent: item.uptimePercent?.toString() ?? null, meanLatencyMs: item.meanLatencyMs?.toString() ?? null,
        state: item.state, breachCandidate: item.breachCandidate
      })),
      merkleRoot: root,
      records: entries.map(({ index, leafDigest, record }) => ({ index, observationId: record.id, leafDigest }))
    };
    const batchDigest = keccak256(toBytes(canonicalJson(manifestBase)));
    const anchorKey = keccak256(toBytes(canonicalJson({ agreementId, agreementVersion: manifestBase.agreementVersion, windowStart: start.toISOString(), windowEnd: end.toISOString() })));
    const batch = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${agreementId}:${manifestBase.agreementVersion}:${start.toISOString()}:${end.toISOString()}`}))`;
      const existingBatch = await transaction.evidenceBatch.findUnique({
        where: { agreementId_agreementVersion_windowStart_windowEnd: { agreementId, agreementVersion: manifestBase.agreementVersion, windowStart: start, windowEnd: end } },
        select: { id: true, agreementVersion: true, windowStart: true, windowEnd: true, schemaVersion: true, algorithmVersion: true, merkleRoot: true, batchDigest: true, observationCount: true, createdAt: true, anchorIntent: { select: { status: true, transactionChainId: true, transactionHash: true } } }
      });
      if (existingBatch) return existingBatch;
      return transaction.evidenceBatch.create({
        data: {
          organizationId: context.organization.id,
          agreementId,
          agreementVersion: manifestBase.agreementVersion,
          windowStart: start,
          windowEnd: end,
          schemaVersion: evidenceSchemaVersion,
          algorithmVersion: kpiAlgorithmVersion,
          merkleRoot: root,
          batchDigest,
          observationCount: observations.length,
          canonicalManifest: { ...manifestBase, batchDigest },
          anchorIntent: { create: { anchorKey } },
          records: {
            create: entries.map((entry) => ({
              observationId: entry.record.id,
              leafIndex: entry.index,
              leafDigest: entry.leafDigest,
              canonicalRecord: entry.record as object,
              inclusionProof: entry.proof as string[]
            }))
          }
        },
        select: { id: true, agreementVersion: true, windowStart: true, windowEnd: true, schemaVersion: true, algorithmVersion: true, merkleRoot: true, batchDigest: true, observationCount: true, createdAt: true, anchorIntent: { select: { status: true, transactionChainId: true, transactionHash: true } } }
      });
    });
    return { ...batch, verification: { algorithm: "keccak256-prefixed-merkle-v1", root: batch.merkleRoot, independentlyVerifiable: false } };
  }

  async export(context: OrganizationAuthContext, agreementId: string, batchId: string) {
    await this.access.requireAgreementReadAccess(context, agreementId);
    const batch = await this.prisma.evidenceBatch.findFirst({
      where: { id: batchId, agreementId },
      include: { records: { orderBy: { leafIndex: "asc" } }, anchorIntent: true }
    });
    if (!batch) throw new NotFoundException("Evidence batch not found.");
    const records = batch.records.map((entry) => ({
      index: entry.leafIndex,
      observationId: entry.observationId,
      record: entry.canonicalRecord,
      leafDigest: entry.leafDigest,
      inclusionProof: entry.inclusionProof
    }));
    const verified = verifyEvidencePackage({ manifest: batch.canonicalManifest as Record<string, unknown>, records: records.map((entry) => ({ ...entry, record: entry.record, leafDigest: entry.leafDigest as `0x${string}`, inclusionProof: entry.inclusionProof as `0x${string}`[] })) });
    return {
      schemaVersion: batch.schemaVersion,
      manifest: batch.canonicalManifest,
      records,
      anchor: batch.anchorIntent ? { status: batch.anchorIntent.status, chainId: batch.anchorIntent.transactionChainId, transactionHash: batch.anchorIntent.transactionHash } : null,
      verification: { valid: verified, merkleRoot: batch.merkleRoot, batchDigest: batch.batchDigest, recordsVerified: records.length }
    };
  }
}
