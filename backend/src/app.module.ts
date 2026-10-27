import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AgreementsModule } from "./agreements/agreements.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { AppConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { OrganizationsModule } from "./organizations/organizations.module.js";
import { SecurityModule } from "./security/security.module.js";
import { MonitoringModule } from "./monitoring/monitoring.module.js";

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    SecurityModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    AgreementsModule,
    MonitoringModule
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter }
  ]
})
export class AppModule {}
