import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { ownerPhone: "+584121234567" },
    update: {},
    create: {
      name: "Arepas La Esquina",
      ownerPhone: "+584121234567",
      status: "ACTIVO",
      zavuSenderId: "sender_seed_demo",
      zavuSenderWebhookSecret: "seed_placeholder_no_es_un_secreto_real",
      zavuAgentId: "agent_seed_demo",
      payoutInstructions: "Pago Móvil: Banco Mercantil, V-12345678, 0412-1234567",
      vesRate: 360.5,
      vesRateUpdatedAt: new Date(),
    },
  });

  await prisma.product.createMany({
    data: [
      {
        merchantId: merchant.id,
        name: "Arepa Reina Pepiada",
        description: "Con pollo, aguacate y mayonesa de la casa",
        priceUsd: 3.5,
        available: true,
        source: "MANUAL_CHAT",
      },
      {
        merchantId: merchant.id,
        name: "Arepa Pelúa",
        description: "Con carne mechada y queso amarillo",
        priceUsd: 4.0,
        available: true,
        source: "MANUAL_CHAT",
      },
      {
        merchantId: merchant.id,
        name: "Jugo de parchita",
        description: null,
        priceUsd: 1.5,
        available: true,
        source: "MANUAL_CHAT",
      },
    ],
  });

  console.log(`Seed listo para el comercio: ${merchant.name} (${merchant.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
