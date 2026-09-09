import { MigrationInterface, QueryRunner } from "typeorm";

export class PanelToken1788911701581 implements MigrationInterface {
    name = 'PanelToken1788911701581'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "merchant" ADD "panelToken" character varying`);
        await queryRunner.query(`ALTER TABLE "merchant" ADD CONSTRAINT "UQ_3af9805f5f61af2b8db6b141f49" UNIQUE ("panelToken")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "merchant" DROP CONSTRAINT "UQ_3af9805f5f61af2b8db6b141f49"`);
        await queryRunner.query(`ALTER TABLE "merchant" DROP COLUMN "panelToken"`);
    }

}
