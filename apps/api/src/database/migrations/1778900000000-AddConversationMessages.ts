import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Переписка клиент↔менеджер (read-only история в админке). Вложения — только file_id,
 * первый xlsx/csv ссылается на documents.id.
 */
export class AddConversationMessages1778900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversation_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL REFERENCES "telegram_users"("id") ON DELETE CASCADE,
        "direction" varchar(20) NOT NULL,
        "manager_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "text" text,
        "attachment_type" varchar(20),
        "attachment_file_id" varchar(255),
        "document_id" uuid REFERENCES "documents"("id") ON DELETE SET NULL,
        "telegram_message_id" bigint,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_conversation_messages_client_created" ON "conversation_messages" ("client_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_conversation_messages_client_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_messages"`);
  }
}
