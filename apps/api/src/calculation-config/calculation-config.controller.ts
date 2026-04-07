import { Body, Controller, Get, Put } from '@nestjs/common';
import { CalculationConfigService } from './calculation-config.service';
import { UpdateCalculationConfigDto } from './dto/update-calculation-config.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';

@Controller('calculation-config')
export class CalculationConfigController {
  constructor(private service: CalculationConfigService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  get() {
    return this.service.get();
  }

  @Put()
  @Roles(UserRole.ADMIN)
  update(@Body() dto: UpdateCalculationConfigDto) {
    return this.service.update(dto);
  }
}
