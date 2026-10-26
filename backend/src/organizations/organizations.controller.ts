import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthContext } from "../auth/auth-context.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { OrganizationsService } from "./organizations.service.js";

@ApiTags("organizations")
@ApiCookieAuth()
@Controller("organizations")
@UseGuards(SessionGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: "List organizations the current user belongs to" })
  list(@AuthContext() context: NonNullable<AuthenticatedRequest["auth"]>) {
    return this.organizations.listForUser(context.user.id);
  }
}
