import { Module } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard.js";
import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsService } from "./organizations.service.js";
import { OrganizationContextGuard } from "./organization-context.guard.js";

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, SessionGuard, OrganizationContextGuard],
  exports: [OrganizationContextGuard]
})
export class OrganizationsModule {}
