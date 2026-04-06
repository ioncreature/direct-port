import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTelegramUsersAndDocuments1775509193348 implements MigrationInterface {
    name = 'AddTelegramUsersAndDocuments1775509193348'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."documents_status_enum" AS ENUM('pending', 'processing', 'processed', 'failed')`);
        await queryRunner.query(`CREATE TABLE "documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "telegram_user_id" uuid NOT NULL, "original_file_name" character varying(500) NOT NULL, "status" "public"."documents_status_enum" NOT NULL DEFAULT 'pending', "column_mapping" jsonb NOT NULL, "parsed_data" jsonb, "result_data" jsonb, "row_count" integer NOT NULL DEFAULT '0', "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "telegram_users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "telegram_id" bigint NOT NULL, "username" character varying(255), "first_name" character varying(255), "last_name" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_88256a651008c00c1eea23e0b61" UNIQUE ("telegram_id"), CONSTRAINT "PK_dcba80e97f84ad7f9bc8f19f472" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_88256a651008c00c1eea23e0b6" ON "telegram_users" ("telegram_id") `);
        await queryRunner.query(`ALTER TABLE "documents" ADD CONSTRAINT "FK_9abb35d0793b56e4734707f305c" FOREIGN KEY ("telegram_user_id") REFERENCES "telegram_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "documents" DROP CONSTRAINT "FK_9abb35d0793b56e4734707f305c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_88256a651008c00c1eea23e0b6"`);
        await queryRunner.query(`DROP TABLE "telegram_users"`);
        await queryRunner.query(`DROP TABLE "documents"`);
        await queryRunner.query(`DROP TYPE "public"."documents_status_enum"`);
    }

}
