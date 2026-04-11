import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TnVedCode } from '../database/entities/tn-ved-code.entity';

@Injectable()
export class TnVedService {
  constructor(@InjectRepository(TnVedCode) private tnVedRepo: Repository<TnVedCode>) {}

  async search(query: string) {
    return this.tnVedRepo
      .createQueryBuilder('t')
      .where('t.code LIKE :q', { q: `${query}%` })
      .orWhere('t.description ILIKE :desc', { desc: `%${query}%` })
      .orderBy('t.code', 'ASC')
      .limit(50)
      .getMany();
  }

  async findByCode(code: string) {
    return this.tnVedRepo.findOne({ where: { code } });
  }
}
