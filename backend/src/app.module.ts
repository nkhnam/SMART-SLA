import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { SlaContractModule } from './sla-contract/sla-contract.module';
import { AdminModule } from './admin/admin.module';
import { BillingModule } from './billing/billing.module';

@Module({
  imports: [PrismaModule, AuthModule, SlaContractModule, AdminModule, BillingModule, ScheduleModule.forRoot()],
})
export class AppModule {}
