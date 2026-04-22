import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Кешированный справочник стран (OKSMT). Источник — TKS /oksmt.json.
 * Обновляется лениво: при первом обращении, если таблица пуста или устарела.
 */
@Entity('countries_cache')
export class Country {
  /** OKSMT-код, 3 цифры. Совпадает с полем CU в TNVEDALL. */
  @PrimaryColumn({ type: 'varchar', length: 3 })
  code: string;

  @Column({ type: 'varchar', length: 2, nullable: true })
  alpha2: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  alpha3: string | null;

  /** Краткое название на русском (например, "КИТАЙ"). */
  @Column({ type: 'varchar', length: 255, name: 'name_ru' })
  nameRu: string;

  /** Полное официальное название (например, "КИТАЙСКАЯ НАРОДНАЯ РЕСПУБЛИКА"). */
  @Column({ type: 'varchar', length: 500, name: 'name_full_ru', nullable: true })
  nameFullRu: string | null;

  @Column({ type: 'varchar', length: 255, name: 'name_en', nullable: true })
  nameEn: string | null;

  @Column({ type: 'timestamptz', name: 'fetched_at', default: () => 'now()' })
  fetchedAt: Date;
}
