import { Module } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard.js";
import { OrganizationContextGuard } from "../organizations/organization-context.guard.js";
import { AuthorizedSignersController } from "./authorized-signers.controller.js";
import { AuthorizedSignersService } from "./authorized-signers.service.js";
import { BlockchainNetworkService } from "./blockchain-network.service.js";
import { AgreementAnchoringService } from "./agreement-anchoring.service.js";

@Module({
  controllers: [AuthorizedSignersController],
  providers: [BlockchainNetworkService, AuthorizedSignersService, AgreementAnchoringService, SessionGuard, OrganizationContextGuard],
  exports: [BlockchainNetworkService, AuthorizedSignersService, AgreementAnchoringService]
})
export class BlockchainModule {}
