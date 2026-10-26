import { Global, Module } from '@nestjs/common';
import { BillingController, BillingPublicController } from './billing.controller';
import { PlanService } from './plan.service';

// Global: các module khác (hợp đồng, Oracle, Marketplace, admin) dùng chung PlanService
@Global()
@Module({
  controllers: [BillingPublicController, BillingController],
  providers: [PlanService],
  exports: [PlanService],
})
export class BillingModule {}
