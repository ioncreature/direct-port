import { Controller, Get, Param, Query } from '@nestjs/common';
import { TnVedService } from './tn-ved.service';

@Controller('tn-ved')
export class TnVedController {
  constructor(private tnVedService: TnVedService) {}

  @Get()
  search(@Query('search') search: string) {
    return this.tnVedService.searchTks(search || '');
  }

  @Get(':code')
  findByCode(@Param('code') code: string) {
    return this.tnVedService.findByCode(code);
  }
}
