import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentPhotos1777900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE document_photo (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        row_index INT NOT NULL,
        image_hash VARCHAR(64) NOT NULL,
        mime_type VARCHAR(20) NOT NULL,
        bytes BYTEA NOT NULL,
        width_px INT,
        height_px INT,
        original_size_bytes INT,
        final_size_bytes INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_document_photo_doc_row ON document_photo (document_id, row_index)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_document_photo_hash ON document_photo (image_hash)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_document_photo_hash`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_document_photo_doc_row`);
    await queryRunner.query(`DROP TABLE IF EXISTS document_photo`);
  }
}
