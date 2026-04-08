import { Controller, Get, Query } from '@nestjs/common';
import { CalculationLogsService } from './calculation-logs.service';
import { FindCalculationLogsQueryDto } from './dto/find-calculation-logs-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';

@Controller('calculation-logs')
export class CalculationLogsController {
  constructor(private service: CalculationLogsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  findAll(@Query() query: FindCalculationLogsQueryDto) {
    return this.service.findAll(query);
  }
}
