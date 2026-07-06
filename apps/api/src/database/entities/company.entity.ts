import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DEFAULT_COMPANY_THEME } from '../../common/tenant/company-theme';
import { CompanyDomain } from './company-domain.entity';

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

  /**
   * Человекочитаемый стабильный ключ компании в URL личного кабинета
   * (`cabinet.directport.ru/<slug>`): по нему кабинет резолвит компанию и подбирает токен бота
   * для верификации Telegram-логина. NULL — у компании нет slug, вход по bare-домену уходит
   * в дефолтную компанию. См. docs/COMPANY_BOTS.md (Фаза 4).
   */
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  slug: string | null;

  /**
   * Токены и username Telegram-ботов компании (client + manager). Токен хранится зашифрованным
   * (SecretCipher, AES-256-GCM); username кэшируется при сохранении токена (резолв через getMe)
   * для ссылок в админке и deep-link менеджера. NULL — у компании нет своего бота, она
   * обслуживается дефолтным ботом платформы. См. docs/COMPANY_BOTS.md.
   *
   * token_enc — select:false: не попадают в обычные findOne/findAll (в т.ч. в ответы API),
   * читаются только явным addSelect там, где нужен расшифрованный токен (internal bots API).
   */
  @Column({ type: 'text', name: 'client_bot_token_enc', nullable: true, select: false })
  clientBotTokenEnc: string | null;

  @Column({ type: 'varchar', length: 255, name: 'client_bot_username', nullable: true })
  clientBotUsername: string | null;

  @Column({ type: 'text', name: 'manager_bot_token_enc', nullable: true, select: false })
  managerBotTokenEnc: string | null;

  @Column({ type: 'varchar', length: 255, name: 'manager_bot_username', nullable: true })
  managerBotUsername: string | null;

  /**
   * Тема оформления админки под тенанта (см. common/tenant/company-theme.ts). admin-web выбирает
   * палитру по этому полю через домен запроса. Дефолт — базовая тема платформы.
   */
  @Column({ type: 'varchar', length: 32, default: DEFAULT_COMPANY_THEME })
  theme: string;

  /**
   * Логотип тенанта: заменяет марку DirectPort в шапке и на входе admin-web. Один логотип на
   * компанию. logo_bytes — select:false: тяжёлые байты не тянутся в обычные findOne/findAll
   * (в т.ч. в ответы API), читаются только явным addSelect при отдаче картинки. logo_mime —
   * image/png (растровые нормализуются в PNG) либо image/svg+xml (санитайзованный SVG). logo_hash —
   * sha256 финальных байт (ETag + cache-busting в URL). NULL — логотипа нет, показывается марка.
   */
  @Column({ type: 'bytea', name: 'logo_bytes', nullable: true, select: false })
  logoBytes: Buffer | null;

  @Column({ type: 'varchar', length: 32, name: 'logo_mime', nullable: true })
  logoMime: string | null;

  @Column({ type: 'varchar', length: 64, name: 'logo_hash', nullable: true })
  logoHash: string | null;

  /** Домены тенанта (0..N). По ним резолвится компания для темизации и гейтинга входа. */
  @OneToMany(() => CompanyDomain, (domain) => domain.company)
  domains: CompanyDomain[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
