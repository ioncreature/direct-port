import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from './company.entity';

/**
 * Доменное имя тенанта. Одна компания может иметь несколько доменов (например, `admin.acme.ru`
 * и `panel.acme.com`). По домену входящего запроса admin-web резолвит компанию: подбирает тему
 * оформления и гейтит вход (пользователь должен принадлежать тенанту домена, см. AuthService).
 *
 * `domain` хранится нормализованным (lowercase host без схемы/порта/пути) и глобально уникален —
 * один домен не может принадлежать двум компаниям. При удалении компании домены удаляются каскадом.
 */
@Entity('company_domains')
export class CompanyDomain {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'company_id' })
  @Index()
  companyId: string;

  @ManyToOne(() => Company, (company) => company.domains, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'varchar', length: 255, unique: true })
  domain: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
