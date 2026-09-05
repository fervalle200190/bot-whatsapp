-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('PENDIENTE_CONEXION', 'ACTIVO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "ProductSource" AS ENUM ('EXTRACCION_FOTO', 'MANUAL_CHAT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('EXTRAYENDO', 'ESPERANDO_CONFIRMACION', 'CONFIRMADO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "Fulfillment" AS ENUM ('RETIRO', 'DELIVERY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('BORRADOR', 'ESPERANDO_PAGO', 'PAGO_EN_REVISION', 'APROBADA', 'RECHAZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ProofDecision" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerPhone" TEXT NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'PENDIENTE_CONEXION',
    "zavuInvitationId" TEXT,
    "zavuSenderId" TEXT,
    "zavuSenderWebhookSecret" TEXT,
    "zavuAgentId" TEXT,
    "payoutInstructions" TEXT,
    "vesRate" DECIMAL(18,4),
    "vesRateUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceUsd" DECIMAL(10,2) NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "source" "ProductSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuImport" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'EXTRAYENDO',
    "extracted" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "buyerPhone" TEXT NOT NULL,
    "buyerName" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'BORRADOR',
    "fulfillment" "Fulfillment",
    "deliveryLat" DECIMAL(10,7),
    "deliveryLng" DECIMAL(10,7),
    "totalUsd" DECIMAL(10,2),
    "totalVes" DECIMAL(18,2),
    "vesRateUsed" DECIMAL(18,4),
    "zavuConversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "unitPriceUsd" DECIMAL(10,2) NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProof" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "zavuMessageId" TEXT NOT NULL,
    "decision" "ProofDecision" NOT NULL DEFAULT 'PENDIENTE',
    "decidedAt" TIMESTAMP(3),
    "merchantNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_ownerPhone_key" ON "Merchant"("ownerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_zavuInvitationId_key" ON "Merchant"("zavuInvitationId");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_zavuSenderId_key" ON "Merchant"("zavuSenderId");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_zavuAgentId_key" ON "Merchant"("zavuAgentId");

-- CreateIndex
CREATE INDEX "Product_merchantId_available_idx" ON "Product"("merchantId", "available");

-- CreateIndex
CREATE INDEX "MenuImport_merchantId_status_idx" ON "MenuImport"("merchantId", "status");

-- CreateIndex
CREATE INDEX "Order_merchantId_status_idx" ON "Order"("merchantId", "status");

-- CreateIndex
CREATE INDEX "Order_merchantId_buyerPhone_status_idx" ON "Order"("merchantId", "buyerPhone", "status");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuImport" ADD CONSTRAINT "MenuImport_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
