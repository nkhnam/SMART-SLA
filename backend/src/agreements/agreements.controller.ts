import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { OrganizationAuth } from "../auth/auth-context.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import type { OrganizationAuthContext } from "./agreement.types.js";
import { OrganizationContextGuard } from "../organizations/organization-context.guard.js";
import {
  AgreementListQueryDto,
  CreateAgreementDto,
  UpdateAgreementDto
} from "./agreement.dto.js";
import { AgreementsService } from "./agreements.service.js";
import { CancelAgreementDto } from "./agreement-cancel.dto.js";

@ApiTags("agreements")
@ApiCookieAuth()
@Controller("agreements")
@UseGuards(SessionGuard, OrganizationContextGuard)
export class AgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get()
  @ApiOperation({ summary: "List draft agreements in the selected organization" })
  list(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Query() query: AgreementListQueryDto
  ) {
    return this.agreements.list(context, query);
  }

  @Post()
  @ApiOperation({ summary: "Create a draft agreement" })
  create(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Body() input: CreateAgreementDto
  ) {
    return this.agreements.create(context, input);
  }

  @Get(":id/versions")
  @ApiOperation({ summary: "List immutable draft revisions" })
  versions(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Param("id", ParseUUIDPipe) id: string
  ) {
    return this.agreements.listVersions(context, id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Read an authorized draft agreement" })
  get(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Param("id", ParseUUIDPipe) id: string
  ) {
    return this.agreements.get(context, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Revise an authorized draft using optimistic concurrency" })
  update(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: UpdateAgreementDto
  ) {
    return this.agreements.update(context, id, input);
  }

  @Post(":id/amend")
  @ApiOperation({ summary: "Create a new immutable agreement version and restart approval" })
  amend(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: UpdateAgreementDto
  ) {
    return this.agreements.amend(context, id, input);
  }

  @Post(":id/cancel")
  @ApiOperation({ summary: "Cancel an agreement before blockchain registration is pending or confirmed" })
  cancel(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: CancelAgreementDto
  ) {
    return this.agreements.cancel(context, id, input.expectedVersion);
  }
}
