import { Controller, Get } from '@nestjs/common';
import { SlaBuilderService } from './sla-builder.service';

@Controller('api/sla-builder')
export class SlaBuilderController {
  constructor(private readonly builder: SlaBuilderService) {}

  // Thư viện KPI + nguồn dữ liệu + template theo ngành cho màn hình tạo SLA
  @Get('catalog')
  catalog() {
    return this.builder.getCatalog();
  }
}
