import { Body, Controller, Get, Put } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';
import { AiConfigService } from './ai-config.service';
import { UpdateAiConfigDto } from './dto/update-ai-config.dto';

@Controller('ai-config')
export class AiConfigController {
  constructor(private service: AiConfigService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  get() {
    return this.service.get();
  }

  @Put()
  @Roles(UserRole.ADMIN)
  update(@Body() dto: UpdateAiConfigDto) {
    return this.service.update(dto);
  }
}
