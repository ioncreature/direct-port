import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalculationLogDocumentIdIndex1777200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_calculation_logs_document_id" ON "calculation_logs" ("document_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_calculation_logs_document_id"`);
  }
}
