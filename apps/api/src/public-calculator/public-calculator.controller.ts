import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { clientIp } from '../common/client-ip';
import { EstimateDto } from './dto/estimate.dto';
import { PublicCalculatorService } from './public-calculator.service';

/**
 * Публичный мини-калькулятор лендинга (без авторизации): один товар → код ТН ВЭД +
 * оценка платежей в ₽. Anti-abuse — fixed-window rate-limit по IP внутри сервиса
 * (PUBLIC_CALC_HOURLY_LIMIT). Вызывается прокси-роутом лендинга /api/calc.
 */
@Controller('public/calculator')
export class PublicCalculatorController {
  constructor(private readonly service: PublicCalculatorService) {}

  @Public()
  @Post('estimate')
  estimate(@Body() dto: EstimateDto, @Req() req: Request) {
    return this.service.estimate(dto, clientIp(req));
  }
}
