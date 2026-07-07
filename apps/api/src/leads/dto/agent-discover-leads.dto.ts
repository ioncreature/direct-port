import { IsOptional, IsUUID } from 'class-validator';
import { DiscoverLeadsDto } from './discover-leads.dto';

/**
 * Запуск discovery автономным агентом (@Internal): в отличие от интерактивного
 * super_admin-эндпоинта, компания приходит не из actor'а, а параметром задания.
 * Не передана → дефолтная компания (обратная совместимость с одно-провайдерным агентом).
 */
export class AgentDiscoverLeadsDto extends DiscoverLeadsDto {
  @IsOptional()
  @IsUUID('loose')
  companyId?: string;
}
