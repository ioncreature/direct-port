import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Компания (тенант). «Проект» в терминах админки: к компании привязаны пользователи,
 * документы, telegram-клиенты и переписка. Обычный пользователь компании видит только
 * данные своей компании и не знает её имени; имя компании видит и управляет ею только
 * super_admin. Обратную @OneToMany на User намеренно не объявляем (избегаем цикла импорта).
 */
@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
