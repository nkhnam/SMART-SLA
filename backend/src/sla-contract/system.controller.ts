import { Controller, Get } from '@nestjs/common';
import { Web3Service } from './web3.service';

@Controller('api/system')
export class SystemController {
  constructor(private readonly web3: Web3Service) {}

  // Tình trạng blockchain + số dư ví backend (ví và contract vốn công khai trên Polygonscan)
  @Get('status')
  status() {
    return this.web3.getStatus();
  }
}
