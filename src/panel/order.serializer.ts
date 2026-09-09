import type { Order } from '../orders/order.entity';
import type { PaymentProof } from '../orders/payment-proof.entity';

export interface OrdenDto {
  id: string;
  status: string;
  buyerPhone: string;
  fulfillment: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  items: { nombre: string; cantidad: number; precioUnitarioUsd: number }[];
  totalUsd: number | null;
  totalVes: number | null;
  vesRateUsed: number | null;
  comprobante: { id: string; decision: string; decidedAt: string | null; url: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** El contrato que consume el SPA (repo separado); publicado también en `/docs`. */
export function serializeOrder(order: Order, lastProof: PaymentProof | null): OrdenDto {
  return {
    id: order.id,
    status: order.status,
    buyerPhone: order.buyerPhone,
    fulfillment: order.fulfillment,
    deliveryLat: order.deliveryLat,
    deliveryLng: order.deliveryLng,
    items: order.items.map((item) => ({
      nombre: item.nameSnapshot,
      cantidad: item.qty,
      precioUnitarioUsd: item.unitPriceUsd,
    })),
    totalUsd: order.totalUsd,
    totalVes: order.totalVes,
    vesRateUsed: order.vesRateUsed,
    comprobante: lastProof
      ? {
          id: lastProof.id,
          decision: lastProof.decision,
          decidedAt: lastProof.decidedAt ? lastProof.decidedAt.toISOString() : null,
          url: `/api/ordenes/${order.id}/comprobante`,
        }
      : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
