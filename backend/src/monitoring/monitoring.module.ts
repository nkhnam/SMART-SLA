import { Module } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard.js";
import { OrganizationContextGuard } from "../organizations/organization-context.guard.js";
import { MonitoringAccessService } from "./monitoring-access.service.js";
import { MonitoringController, MonitoringWebhookController } from "./monitoring.controller.js";
import { MonitoringKpiService } from "./monitoring-kpi.service.js";
import { MonitoringEvidenceService } from "./monitoring-evidence.service.js";
import { MonitoringSourceService } from "./monitoring-source.service.js";
import { MonitoringWorkerService } from "./monitoring-worker.service.js";
import { EVIDENCE_RPC_CLIENT, EvidenceAnchorWorkerService, createEvidenceRpcClient } from "./evidence-anchor-worker.service.js";
import { MonitoringRetentionService } from "./monitoring-retention.service.js";
import { MONITORING_HTTP_PROBE, probeHttpEndpoint } from "./http-probe.js";

@Module({
  controllers: [MonitoringController, MonitoringWebhookController],
  providers: [{ provide: EVIDENCE_RPC_CLIENT, useValue: createEvidenceRpcClient }, { provide: MONITORING_HTTP_PROBE, useValue: probeHttpEndpoint }, MonitoringAccessService, MonitoringKpiService, MonitoringEvidenceService, MonitoringSourceService, MonitoringWorkerService, EvidenceAnchorWorkerService, MonitoringRetentionService, SessionGuard, OrganizationContextGuard]
})
export class MonitoringModule {}
