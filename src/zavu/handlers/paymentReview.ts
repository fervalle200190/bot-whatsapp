import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { getZavuClient, withSender } from "../client.js";
import { isWindowOpenForContact } from "../window.js";
import type { Env } from "../../env.js";

export function approveButtonId(orderId: string): string {
  return `aprobar_${orderId}`;
}

export function rejectButtonId(orderId: string): string {
  return `rechazar_${orderId}`;
}

function formatOrderSummary(items: { nameSnapshot: string; qty: number; unitPriceUsd: unknown }[]): string {
  return items.map((i) => `• ${i.qty}x ${i.nameSnapshot}`).join("\n");
}

/**
 * Le avisa al dueño del comercio (por el número OPERADOR — el dueño no puede
 * escribirle a su propio número de WhatsApp, ver spec sección 1) que hay un
 * comprobante para revisar: la imagen, el resumen, y los dos botones.
 */
export async function notifyMerchantForReview(
  orderId: string,
  env: Env,
  log: FastifyBaseLogger,
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      merchant: true,
      proofs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const proof = order?.proofs[0];
  if (!order || !proof) {
    log.warn({ orderId }, "no se encontró la orden o el comprobante para avisar al comercio");
    return;
  }

  const zavu = getZavuClient(env.ZAVU_API_KEY);
  const operator = withSender(env.ZAVU_OPERATOR_SENDER_ID);
  const totalUsd = order.totalUsd ? Number(order.totalUsd) : 0;
  const totalVes = order.totalVes ? Number(order.totalVes) : 0;

  const windowOpen = await isWindowOpenForContact(zavu, env.ZAVU_OPERATOR_SENDER_ID, order.merchant.ownerPhone);

  if (!windowOpen) {
    // Fuera de la ventana de 24h, un mensaje libre (imagen o botones) sería
    // rechazado por WhatsApp. Mandamos solo el aviso por plantilla; los
    // botones de Aprobar/Rechazar quedan pendientes hasta que el comercio
    // responda y la ventana se reabra — ver spec sección 6/7, limitación
    // conocida de este MVP.
    try {
      await zavu.messages.send(
        {
          to: order.merchant.ownerPhone,
          messageType: "template",
          content: { templateId: env.ZAVU_PAGO_EN_REVISION_TEMPLATE_ID },
        },
        operator,
      );
    } catch (err) {
      log.error({ err, orderId }, "no se pudo enviar la plantilla de aviso de pago pendiente");
    }
    return;
  }

  try {
    await zavu.messages.send(
      {
        to: order.merchant.ownerPhone,
        messageType: "image",
        content: { mediaUrl: proof.imageUrl },
        text: "Comprobante de pago recibido",
      },
      operator,
    );

    await zavu.messages.send(
      {
        to: order.merchant.ownerPhone,
        messageType: "buttons",
        text: `Pedido de ${order.buyerPhone}\n\n${formatOrderSummary(order.items)}\n\nTotal: $${totalUsd.toFixed(2)} (Bs. ${totalVes.toFixed(2)})\n\n¿Aprobás el pago?`,
        content: {
          buttons: [
            { id: approveButtonId(order.id), title: "Aprobar" },
            { id: rejectButtonId(order.id), title: "Rechazar" },
          ],
        },
      },
      operator,
    );
  } catch (err) {
    log.error({ err, orderId }, "no se pudo avisar al comercio para revisar el pago");
  }
}
