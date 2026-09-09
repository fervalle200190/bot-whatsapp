import { MigrationInterface, QueryRunner } from "typeorm";

export class MetaChannel1788911021764 implements MigrationInterface {
    name = 'MetaChannel1788911021764'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payment_proof" RENAME COLUMN "imageUrl" TO "mediaId"`);
        await queryRunner.query(`ALTER TABLE "merchant" ADD "metaPhoneNumberId" character varying`);
        await queryRunner.query(`ALTER TABLE "merchant" ADD CONSTRAINT "UQ_3f13041d636fa1b6c7e2430b376" UNIQUE ("metaPhoneNumberId")`);
        await queryRunner.query(`ALTER TABLE "merchant" ADD "metaDisplayPhone" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "merchant" DROP COLUMN "metaDisplayPhone"`);
        await queryRunner.query(`ALTER TABLE "merchant" DROP CONSTRAINT "UQ_3f13041d636fa1b6c7e2430b376"`);
        await queryRunner.query(`ALTER TABLE "merchant" DROP COLUMN "metaPhoneNumberId"`);
        await queryRunner.query(`ALTER TABLE "payment_proof" RENAME COLUMN "mediaId" TO "imageUrl"`);
    }

}
