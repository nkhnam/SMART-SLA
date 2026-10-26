import { Module } from '@nestjs/common';
import { SlaContractService } from './sla-contract.service';
import { TerminationAlertService } from './termination-alert.service';
import { ReconciliationService } from './reconciliation.service';
import { PenaltyCapService } from './penalty-cap.service';
import { TimelineService } from './timeline.service';
import { SourceCompareService } from './source-compare.service';
import { AdminMonitoringController, SourceCompareController } from './source-compare.controller';
import { DashboardController } from './dashboard.controller';
import { NegotiationSummaryService } from './negotiation-summary.service';
import { SlaContractController } from './sla-contract.controller';
import { Web3Service } from './web3.service';
import { OracleService } from './oracle.service';
import { ViolationService } from './violation.service';
import { ViolationController } from './violation.controller';
import { DemoProviderController } from './demo-provider.controller';
import { WebhookController } from './webhook.controller';
import { ContractAccessService } from './contract-access.service';
import { SlaBuilderService } from './sla-builder.service';
import { SlaBuilderController } from './sla-builder.controller';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceController } from './marketplace.controller';
import { SystemController } from './system.controller';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { SigningService } from './signing.service';
import { SigningController } from './signing.controller';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { ListingService } from './listing.service';
import { AdminListingController, ListingController } from './listing.controller';

@Module({
  controllers: [SlaContractController, ViolationController, DemoProviderController, WebhookController, SlaBuilderController, MarketplaceController, SystemController, NotificationController, SigningController, TicketController, ListingController, AdminListingController, DashboardController, SourceCompareController, AdminMonitoringController],
  providers: [SlaContractService, Web3Service, OracleService, ViolationService, ContractAccessService, SlaBuilderService, MarketplaceService, NotificationService, SigningService, TicketService, ListingService, TerminationAlertService,
    ReconciliationService,
    PenaltyCapService, TimelineService, NegotiationSummaryService, SourceCompareService],
})
export class SlaContractModule {}
