import { Controller, Get, Param, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';
import { TnVedService } from './tn-ved.service';

@Controller('tn-ved')
export class TnVedController {
  constructor(private tnVedService: TnVedService) {}

  @Get()
  search(@Query('search') search: string) {
    return this.tnVedService.searchTks(search || '');
  }

  @Get(':code/regulatory-explanations')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  getRegulatoryExplanations(
    @Param('code') code: string,
    @Query('lang') lang?: string,
  ) {
    return this.tnVedService.getRegulatoryExplanations(code, lang);
  }

  @Get(':code')
  findByCode(@Param('code') code: string) {
    return this.tnVedService.findByCode(code);
  }
}
