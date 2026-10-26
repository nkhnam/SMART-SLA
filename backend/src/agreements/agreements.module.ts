import { Module } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard.js";
import { OrganizationContextGuard } from "../organizations/organization-context.guard.js";
import { AgreementsController } from "./agreements.controller.js";
import { AgreementsService } from "./agreements.service.js";

@Module({
  controllers: [AgreementsController],
  providers: [AgreementsService, SessionGuard, OrganizationContextGuard]
})
export class AgreementsModule {}
