import { Body, Controller, Get, Headers, InternalServerErrorException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { OrganizationAuth } from "../auth/auth-context.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { OrganizationContextGuard } from "../organizations/organization-context.guard.js";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";
import { BuildEvidenceDto, CreateMonitoringSourceDto, EvaluateMonitoringKpisDto, MonitoringObservationQueryDto, UpdateMonitoringSourceDto, WebhookObservationDto } from "./monitoring.dto.js";
import { MonitoringEvidenceService } from "./monitoring-evidence.service.js";
import { MonitoringKpiService } from "./monitoring-kpi.service.js";
import { MonitoringSourceService } from "./monitoring-source.service.js";

@ApiTags("monitoring")
@ApiCookieAuth()
@Controller("agreements/:agreementId/monitoring")
@UseGuards(SessionGuard, OrganizationContextGuard)
export class MonitoringController {
  constructor(private readonly sources: MonitoringSourceService, private readonly kpis: MonitoringKpiService, private readonly evidence: MonitoringEvidenceService) {}

  @Get("sources")
  @ApiOperation({ summary: "List monitoring sources for an active signed agreement" })
  listSources(@OrganizationAuth() context: OrganizationAuthContext, @Param("agreementId", ParseUUIDPipe) agreementId: string) {
    return this.sources.listSources(context, agreementId);
  }

  @Post("sources")
  @ApiOperation({ summary: "Create an HTTP probe or signed webhook monitoring source" })
  createSource(@OrganizationAuth() context: OrganizationAuthContext, @Param("agreementId", ParseUUIDPipe) agreementId: string, @Body() input: CreateMonitoringSourceDto) {
    return this.sources.createSource(context, agreementId, input);
  }

  @Patch("sources/:sourceId")
  updateSource(@OrganizationAuth() context: OrganizationAuthContext, @Param("agreementId", ParseUUIDPipe) agreementId: string, @Param("sourceId", ParseUUIDPipe) sourceId: string, @Body() input: UpdateMonitoringSourceDto) {
    return this.sources.updateSource(context, agreementId, sourceId, input);
  }

  @Get("observations")
  listObservations(@OrganizationAuth() context: OrganizationAuthContext, @Param("agreementId", ParseUUIDPipe) agreementId: string, @Query() query: MonitoringObservationQueryDto) {
    return this.sources.listObservations(context, agreementId, query);
  }

  @Get("kpis")
  listKpis(@OrganizationAuth() context: OrganizationAuthContext, @Param("agreementId", ParseUUIDPipe) agreementId: string) {
    return this.sources.listEvaluations(context, agreementId);
  }

  @Post("kpis/evaluate")
  evaluateKpis(@OrganizationAuth() context: OrganizationAuthContext, @Param("agreementId", ParseUUIDPipe) agreementId: string, @Body() input: EvaluateMonitoringKpisDto) {
    return this.kpis.evaluate(context, agreementId, input.windowStart, input.windowEnd, input.sourceId);
  }

  @Get("breaches")
  listBreaches(@OrganizationAuth() context: OrganizationAuthContext, @Param("agreementId", ParseUUIDPipe) agreementId: string) {
    return this.sources.listBreachCandidates(context, agreementId);
  }

  @Post("evidence")
  buildEvidence(@OrganizationAuth() context: OrganizationAuthContext, @Param("agreementId", ParseUUIDPipe) agreementId: string, @Body() input: BuildEvidenceDto) {
    return this.evidence.build(context, agreementId, input.windowStart, input.windowEnd);
  }

  @Get("evidence/:batchId")
  exportEvidence(@OrganizationAuth() context: OrganizationAuthContext, @Param("agreementId", ParseUUIDPipe) agreementId: string, @Param("batchId", ParseUUIDPipe) batchId: string) {
    return this.evidence.export(context, agreementId, batchId);
  }
}

@ApiTags("monitoring-webhooks")
@Controller("monitoring/webhooks")
export class MonitoringWebhookController {
  constructor(private readonly sources: MonitoringSourceService) {}

  @Post(":sourceId")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: "Ingest a signed provider observation" })
  ingest(
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
    @Body() input: WebhookObservationDto,
    @Req() request: Request & { rawBody?: Buffer },
    @Headers("x-monitoring-timestamp") timestamp: string,
    @Headers("x-monitoring-nonce") nonce: string,
    @Headers("x-monitoring-event-id") eventId: string,
    @Headers("x-monitoring-signature") signature: string
  ) {
    if (!request.rawBody) throw new InternalServerErrorException("Raw webhook request body is unavailable.");
    return this.sources.ingestWebhook(sourceId, input, request.rawBody, { timestamp, nonce, eventId }, signature);
  }
}
