import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

const retentionSweepMs = 24 * 60 * 60 * 1000;

@Injectable()
export class MonitoringRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringRetentionService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.purgeExpired(), retentionSweepMs);
    this.timer.unref();
    void this.purgeExpired();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async purgeExpired(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const result = await this.prisma.monitoringObservation.deleteMany({
        where: {
          retentionUntil: { lt: new Date() },
          evidenceRecords: { none: {} }
        }
      });
      return result.count;
    } catch (error) {
      this.logger.warn(`Monitoring retention sweep failed (${error instanceof Error ? error.name : "unknown"}).`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
