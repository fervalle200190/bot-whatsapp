import { prisma } from "./prisma.js";

export interface CartSnapshot {
  items: { nombre: string; cantidad: number; precioUnitarioUsd: number }[];
  totalUsd: number;
  totalVes: number | null;
}

/** Un carrito ES una Order en BORRADOR. A lo sumo una por (merchantId, buyerPhone). */
export async function getOrCreateDraftOrder(merchantId: string, buyerPhone: string) {
  const existing = await prisma.order.findFirst({
    where: { merchantId, buyerPhone, status: "BORRADOR" },
  });
  if (existing) return existing;

  return prisma.order.create({
    data: { merchantId, buyerPhone, status: "BORRADOR" },
  });
}

export async function buildCartSnapshot(orderId: string, merchantId: string): Promise<CartSnapshot> {
  const [items, merchant] = await Promise.all([
    prisma.orderItem.findMany({ where: { orderId } }),
    prisma.merchant.findUnique({ where: { id: merchantId }, select: { vesRate: true } }),
  ]);

  const totalUsd = items.reduce((sum, item) => sum + Number(item.unitPriceUsd) * item.qty, 0);
  const vesRate = merchant?.vesRate ? Number(merchant.vesRate) : null;

  return {
    items: items.map((item) => ({
      nombre: item.nameSnapshot,
      cantidad: item.qty,
      precioUnitarioUsd: Number(item.unitPriceUsd),
    })),
    totalUsd: Math.round(totalUsd * 100) / 100,
    totalVes: vesRate ? Math.round(totalUsd * vesRate * 100) / 100 : null,
  };
}
