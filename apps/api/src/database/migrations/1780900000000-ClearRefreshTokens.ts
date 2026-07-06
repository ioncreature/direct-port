import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refresh-токены теперь хранятся как sha256(token) в индексированной колонке token_hash
 * (раньше — солёный bcrypt-хеш, из-за чего logout/refresh перебирали всю таблицу с bcrypt.compare
 * на каждой строке — отсюда logout по 5–10 секунд на выросшей таблице). Старые bcrypt-хеши в новой
 * схеме не матчатся, поэтому вычищаем таблицу целиком (заодно уходят и протухшие строки, которые
 * раньше никто не удалял). Активные сессии при следующем refresh получат 401 и перелогинятся;
 * access-JWT (15 мин) доживают до истечения.
 */
export class ClearRefreshTokens1780900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "refresh_tokens"`);
  }

  public async down(): Promise<void> {
    // no-op: удалённые refresh-токены восстановить невозможно и не требуется.
  }
}
