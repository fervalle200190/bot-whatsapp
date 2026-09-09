import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1788910480324 implements MigrationInterface {
    name = 'InitialSchema1788910480324'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."product_source_enum" AS ENUM('EXTRACCION_FOTO', 'MANUAL_CHAT')`);
        await queryRunner.query(`CREATE TABLE "product" ("id" character varying(32) NOT NULL, "merchantId" character varying NOT NULL, "name" character varying NOT NULL, "description" text, "priceUsd" numeric(10,2) NOT NULL, "available" boolean NOT NULL DEFAULT true, "source" "public"."product_source_enum" NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bebc9158e480b949565b4dc7a82" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_79dbe828e6ddb117c1a152b305" ON "product" ("merchantId", "available") `);
        await queryRunner.query(`CREATE TYPE "public"."menu_import_status_enum" AS ENUM('EXTRAYENDO', 'ESPERANDO_CONFIRMACION', 'CONFIRMADO', 'DESCARTADO')`);
        await queryRunner.query(`CREATE TABLE "menu_import" ("id" character varying(32) NOT NULL, "merchantId" character varying NOT NULL, "sourceUrl" character varying NOT NULL, "status" "public"."menu_import_status_enum" NOT NULL DEFAULT 'EXTRAYENDO', "extracted" jsonb NOT NULL, "model" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f413ae4af807bcd7c0cf806e2da" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_dce4db446dbcbb73d9159c9043" ON "menu_import" ("merchantId", "status") `);
        await queryRunner.query(`CREATE TABLE "order_item" ("id" character varying(32) NOT NULL, "orderId" character varying NOT NULL, "productId" character varying NOT NULL, "nameSnapshot" character varying NOT NULL, "unitPriceUsd" numeric(10,2) NOT NULL, "qty" integer NOT NULL, CONSTRAINT "PK_d01158fe15b1ead5c26fd7f4e90" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."payment_proof_decision_enum" AS ENUM('PENDIENTE', 'APROBADO', 'RECHAZADO')`);
        await queryRunner.query(`CREATE TABLE "payment_proof" ("id" character varying(32) NOT NULL, "orderId" character varying NOT NULL, "imageUrl" character varying NOT NULL, "sourceMessageId" character varying NOT NULL, "decision" "public"."payment_proof_decision_enum" NOT NULL DEFAULT 'PENDIENTE', "decidedAt" TIMESTAMP WITH TIME ZONE, "merchantNote" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_64c0963ecc0ec5d064ebefff10f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."order_status_enum" AS ENUM('BORRADOR', 'ESPERANDO_PAGO', 'PAGO_EN_REVISION', 'APROBADA', 'RECHAZADA', 'CANCELADA')`);
        await queryRunner.query(`CREATE TYPE "public"."order_fulfillment_enum" AS ENUM('RETIRO', 'DELIVERY')`);
        await queryRunner.query(`CREATE TABLE "order" ("id" character varying(32) NOT NULL, "merchantId" character varying NOT NULL, "buyerPhone" character varying NOT NULL, "buyerName" character varying, "status" "public"."order_status_enum" NOT NULL DEFAULT 'BORRADOR', "fulfillment" "public"."order_fulfillment_enum", "deliveryLat" numeric(10,7), "deliveryLng" numeric(10,7), "totalUsd" numeric(10,2), "totalVes" numeric(18,2), "vesRateUsed" numeric(18,4), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1031171c13130102495201e3e20" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_46f70b44609806f2209c0b38a5" ON "order" ("merchantId", "buyerPhone", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_0e9dae9725a24c513127220c87" ON "order" ("merchantId", "status") `);
        await queryRunner.query(`CREATE TYPE "public"."merchant_status_enum" AS ENUM('PENDIENTE_CONEXION', 'ACTIVO', 'SUSPENDIDO')`);
        await queryRunner.query(`CREATE TABLE "merchant" ("id" character varying(32) NOT NULL, "name" character varying NOT NULL, "ownerPhone" character varying NOT NULL, "status" "public"."merchant_status_enum" NOT NULL DEFAULT 'PENDIENTE_CONEXION', "payoutInstructions" text, "vesRate" numeric(18,4), "vesRateUpdatedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_29ff16c7c1c8e59d397a44e1f41" UNIQUE ("ownerPhone"), CONSTRAINT "PK_9a3850e0537d869734fc9bff5d6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "product" ADD CONSTRAINT "FK_62fcc319202f6ec1f6819e1d5f5" FOREIGN KEY ("merchantId") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "menu_import" ADD CONSTRAINT "FK_cc901df4bd18f489f6a0e14d243" FOREIGN KEY ("merchantId") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_item" ADD CONSTRAINT "FK_646bf9ece6f45dbe41c203e06e0" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_proof" ADD CONSTRAINT "FK_3780af1d47e71b1f6005eb4c93e" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order" ADD CONSTRAINT "FK_293ad75db4c3b2aa62996c75ad1" FOREIGN KEY ("merchantId") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order" DROP CONSTRAINT "FK_293ad75db4c3b2aa62996c75ad1"`);
        await queryRunner.query(`ALTER TABLE "payment_proof" DROP CONSTRAINT "FK_3780af1d47e71b1f6005eb4c93e"`);
        await queryRunner.query(`ALTER TABLE "order_item" DROP CONSTRAINT "FK_646bf9ece6f45dbe41c203e06e0"`);
        await queryRunner.query(`ALTER TABLE "menu_import" DROP CONSTRAINT "FK_cc901df4bd18f489f6a0e14d243"`);
        await queryRunner.query(`ALTER TABLE "product" DROP CONSTRAINT "FK_62fcc319202f6ec1f6819e1d5f5"`);
        await queryRunner.query(`DROP TABLE "merchant"`);
        await queryRunner.query(`DROP TYPE "public"."merchant_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0e9dae9725a24c513127220c87"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_46f70b44609806f2209c0b38a5"`);
        await queryRunner.query(`DROP TABLE "order"`);
        await queryRunner.query(`DROP TYPE "public"."order_fulfillment_enum"`);
        await queryRunner.query(`DROP TYPE "public"."order_status_enum"`);
        await queryRunner.query(`DROP TABLE "payment_proof"`);
        await queryRunner.query(`DROP TYPE "public"."payment_proof_decision_enum"`);
        await queryRunner.query(`DROP TABLE "order_item"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dce4db446dbcbb73d9159c9043"`);
        await queryRunner.query(`DROP TABLE "menu_import"`);
        await queryRunner.query(`DROP TYPE "public"."menu_import_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_79dbe828e6ddb117c1a152b305"`);
        await queryRunner.query(`DROP TABLE "product"`);
        await queryRunner.query(`DROP TYPE "public"."product_source_enum"`);
    }

}
