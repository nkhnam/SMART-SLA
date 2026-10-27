import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { OrganizationAuth } from "../auth/auth-context.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { OrganizationContextGuard } from "../organizations/organization-context.guard.js";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";
import { AuthorizedSignersService } from "./authorized-signers.service.js";
import { CreateSignerChallengeDto, VerifySignerChallengeDto } from "./authorized-signers.dto.js";

@ApiTags("organization signers")
@ApiCookieAuth()
@Controller("organizations/signers")
@UseGuards(SessionGuard, OrganizationContextGuard)
export class AuthorizedSignersController {
  constructor(private readonly signers: AuthorizedSignersService) {}

  @Get()
  @ApiOperation({ summary: "List verified signer wallets for the selected organization" })
  list(@OrganizationAuth() context: OrganizationAuthContext) {
    return this.signers.list(context);
  }

  @Post("challenge")
  @ApiOperation({ summary: "Create a wallet ownership challenge" })
  challenge(@OrganizationAuth() context: OrganizationAuthContext, @Body() input: CreateSignerChallengeDto) {
    return this.signers.createChallenge(context, input.address);
  }

  @Post("verify")
  @ApiOperation({ summary: "Verify wallet ownership and authorize the signer" })
  verify(@OrganizationAuth() context: OrganizationAuthContext, @Body() input: VerifySignerChallengeDto) {
    return this.signers.verifyChallenge(context, input.challengeId, input.signature);
  }

  @Post(":id/revoke")
  @ApiOperation({ summary: "Revoke a signer wallet not bound to an active signing snapshot" })
  revoke(@OrganizationAuth() context: OrganizationAuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.signers.revoke(context, id);
  }
}
