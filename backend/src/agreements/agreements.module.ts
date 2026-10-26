import { Module } from "@nestjs/common";
import { BlockchainModule } from "../blockchain/blockchain.module.js";
import { SessionGuard } from "../auth/session.guard.js";
import { OrganizationContextGuard } from "../organizations/organization-context.guard.js";
import { AgreementsController } from "./agreements.controller.js";
import { AgreementWorkflowController } from "./agreement-workflow.controller.js";
import { AgreementParticipationService } from "./agreement-participation.service.js";
import { AgreementSigningService } from "./agreement-signing.service.js";
import { AgreementsService } from "./agreements.service.js";

@Module({
  imports: [BlockchainModule],
  controllers: [AgreementsController, AgreementWorkflowController],
  providers: [AgreementsService, AgreementParticipationService, AgreementSigningService, SessionGuard, OrganizationContextGuard]
})
export class AgreementsModule {}
