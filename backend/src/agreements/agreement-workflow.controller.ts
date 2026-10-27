import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { OrganizationAuth } from "../auth/auth-context.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { OrganizationContextGuard } from "../organizations/organization-context.guard.js";
import type { OrganizationAuthContext } from "./agreement.types.js";
import { CreateAgreementInvitationDto } from "./agreement-workflow.dto.js";
import { AgreementParticipationService } from "./agreement-participation.service.js";
import { AgreementSigningService } from "./agreement-signing.service.js";
import { SelectAgreementSignerDto, SubmitAgreementSignatureDto } from "./agreement-signing.dto.js";
import { AgreementAnchoringService } from "../blockchain/agreement-anchoring.service.js";

@ApiTags("agreement workflow")
@ApiCookieAuth()
@Controller("agreements")
@UseGuards(SessionGuard, OrganizationContextGuard)
export class AgreementWorkflowController {
  constructor(
    private readonly participation: AgreementParticipationService,
    private readonly signing: AgreementSigningService,
    private readonly anchoring: AgreementAnchoringService
  ) {}

  @Get("invitations")
  @ApiOperation({ summary: "List invitations addressed to the selected organization" })
  listInvitations(@OrganizationAuth() context: OrganizationAuthContext) {
    return this.participation.listInvitations(context);
  }

  @Post(":id/invitations")
  @ApiOperation({ summary: "Invite an existing organization to a draft agreement" })
  createInvitation(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: CreateAgreementInvitationDto
  ) {
    return this.participation.createInvitation(context, id, input.organizationId);
  }

  @Post(":id/invitations/:invitationId/accept")
  @ApiOperation({ summary: "Accept a pending invitation as an organization OWNER or ADMIN" })
  acceptInvitation(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("invitationId", ParseUUIDPipe) invitationId: string
  ) {
    return this.participation.acceptInvitation(context, id, invitationId);
  }

  @Post(":id/invitations/:invitationId/reject")
  @ApiOperation({ summary: "Reject a pending invitation as an organization OWNER or ADMIN" })
  rejectInvitation(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("invitationId", ParseUUIDPipe) invitationId: string
  ) {
    return this.participation.rejectInvitation(context, id, invitationId);
  }

  @Post(":id/signers")
  @ApiOperation({ summary: "Select the current organization's authorized wallet for signing" })
  selectSigner(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: SelectAgreementSignerDto
  ) {
    return this.signing.selectSigner(context, id, input.authorizedSignerId);
  }

  @Post(":id/signing/prepare")
  @ApiOperation({ summary: "Freeze the current agreement version and return its two-party EIP-712 message" })
  prepareSigning(@OrganizationAuth() context: OrganizationAuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.signing.prepareSigning(context, id);
  }

  @Get(":id/signing")
  @ApiOperation({ summary: "Read current signing snapshot and collected signer addresses" })
  getSigning(@OrganizationAuth() context: OrganizationAuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.signing.getSigning(context, id);
  }

  @Post(":id/signatures")
  @ApiOperation({ summary: "Submit the selected organization's EIP-712 approval" })
  submitSignature(
    @OrganizationAuth() context: OrganizationAuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: SubmitAgreementSignatureDto
  ) {
    return this.signing.submitSignature(context, id, input.signature);
  }

  @Get(":id/anchor")
  @ApiOperation({ summary: "Read the persisted anchor status and transaction reconciliation details" })
  getAnchor(@OrganizationAuth() context: OrganizationAuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.anchoring.getStatus(context, id);
  }

  @Post(":id/anchor/retry")
  @ApiOperation({ summary: "Requeue a failed anchor transaction for reconciliation and retry" })
  retryAnchor(@OrganizationAuth() context: OrganizationAuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.anchoring.retry(context, id);
  }

  @Get(":id/verification")
  @ApiOperation({ summary: "Independently compare the current snapshot against the configured registry" })
  verifyAgreement(@OrganizationAuth() context: OrganizationAuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.anchoring.verifyAgreement(context, id);
  }
}
