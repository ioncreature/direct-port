import { Body, Controller, Get, Put } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';
import { CalculationConfigService } from './calculation-config.service';
import { UpdateCalculationConfigDto } from './dto/update-calculation-config.dto';

@Controller('calculation-config')
export class CalculationConfigController {
  constructor(private service: CalculationConfigService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  get() {
    return this.service.get();
  }

  @Put()
  @Roles(UserRole.SUPER_ADMIN)
  update(@Body() dto: UpdateCalculationConfigDto) {
    return this.service.update(dto);
  }
}
