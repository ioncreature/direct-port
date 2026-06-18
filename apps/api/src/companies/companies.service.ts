import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { Company } from '../database/entities/company.entity';
import { User } from '../database/entities/user.entity';
import { CreateCompanyDto } from './dto/create-company.dto';
import { FindCompaniesQueryDto } from './dto/find-companies-query.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company) private companiesRepo: Repository<Company>,
    @InjectRepository(User) private usersRepo: Repository<User>,
  ) {}

  async findAll(query: FindCompaniesQueryDto): Promise<PaginatedResponse<Company>> {
    const [data, total] = await this.companiesRepo.findAndCount({
      order: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<Company> {
    const company = await this.companiesRepo.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async create(dto: CreateCompanyDto): Promise<Company> {
    const name = dto.name.trim();
    const exists = await this.companiesRepo.findOne({ where: { name } });
    if (exists) throw new ConflictException('Company name already in use');
    return this.companiesRepo.save(this.companiesRepo.create({ name }));
  }

  async update(id: string, dto: UpdateCompanyDto): Promise<Company> {
    const company = await this.findOne(id);
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const exists = await this.companiesRepo.findOne({ where: { name } });
      if (exists && exists.id !== id) throw new ConflictException('Company name already in use');
      company.name = name;
    }
    return this.companiesRepo.save(company);
  }

  async remove(id: string): Promise<void> {
    const company = await this.findOne(id);
    // Удаление непустой компании запрещаем: FK users.company_id = RESTRICT всё равно отобьёт,
    // но явная проверка даёт понятное сообщение. Документы/клиенты при удалении получили бы
    // company_id = NULL (FK SET NULL) — поэтому удаляем только полностью пустые компании.
    const userCount = await this.usersRepo.count({ where: { companyId: id } });
    if (userCount > 0) {
      throw new ConflictException('Cannot delete a company that still has users');
    }
    await this.companiesRepo.remove(company);
  }
}
