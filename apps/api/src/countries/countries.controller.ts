import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';
import { CountriesService } from './countries.service';

@Controller('countries')
export class CountriesController {
  constructor(private service: CountriesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async list() {
    const countries = await this.service.listAll();
    return countries.map((c) => ({
      code: c.code,
      alpha2: c.alpha2,
      alpha3: c.alpha3,
      nameRu: c.nameRu,
      nameFullRu: c.nameFullRu,
      nameEn: c.nameEn,
    }));
  }
}
