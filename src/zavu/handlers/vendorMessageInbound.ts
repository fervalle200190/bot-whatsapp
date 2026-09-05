import { z } from "zod";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { getZavuClient, withSender } from "../client.js";
import { resolveMediaUrl } from "../media.js";
import { notifyMerchantForReview } from "./paymentReview.js";
import type { Env } from "../../env.js";

const vendorMessageSchema = z
  .object({
    messageId: z.string(),
    from: z.string(),
    messageType: z.string(),
    content: z
      .object({
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        mediaId: z.string().optional(),
        mediaUrl: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

async function handleLocation(
  data: z.infer<typeof vendorMessageSchema>,
  merchantId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  if (data.content?.latitude === undefined || data.content?.longitude === undefined) return;

  const order = await prisma.order.findFirst({
    where: {
      merchantId,
      buyerPhone: data.from,
      status: "BORRADOR",
      fulfillment: "DELIVERY",
      deliveryLat: null,
    },
  });

  if (!order) {
    log.info({ merchantId, buyerPhone: data.from }, "ubicación recibida sin una orden esperándola");
    return;
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { deliveryLat: data.content.latitude, deliveryLng: data.content.longitude },
  });

  log.info({ orderId: order.id }, "ubicación de entrega guardada");
}

async function handlePaymentProof(
  data: z.infer<typeof vendorMessageSchema>,
  merchantId: string,
  env: Env,
  log: FastifyBaseLogger,
): Promise<void> {
  const order = await prisma.order.findFirst({
    where: { merchantId, buyerPhone: data.from, status: "ESPERANDO_PAGO" },
  });

  if (!order) {
    log.info({ merchantId, buyerPhone: data.from }, "imagen recibida sin una orden esperando pago");
    return;
  }

  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant?.zavuSenderId) return;

  const zavu = getZavuClient(env.ZAVU_API_KEY);
  const vendor = withSender(merchant.zavuSenderId);

  const mediaUrl = await resolveMediaUrl(zavu, data.messageId, data.content?.mediaUrl);

  if (!mediaUrl) {
    log.warn({ orderId: order.id, messageId: data.messageId }, "no se pudo obtener mediaUrl del comprobante");
    try {
      await zavu.messages.send(
        { to: data.from, text: "No pude ver el comprobante. ¿Podés reenviarlo?" },
        vendor,
      );
    } catch (err) {
      log.error({ err, orderId: order.id }, "no se pudo avisar sobre el comprobante ilegible");
    }
    return;
  }

  await prisma.$transaction([
    prisma.paymentProof.create({
      data: { orderId: order.id, imageUrl: mediaUrl, zavuMessageId: data.messageId, decision: "PENDIENTE" },
    }),
    prisma.order.update({
      where: { id: order.id },
      data: { status: "PAGO_EN_REVISION" },
    }),
  ]);

  log.info({ orderId: order.id }, "comprobante recibido, orden en revisión");

  try {
    await zavu.messages.send(
      { to: data.from, text: "Recibimos tu comprobante. Te confirmamos apenas el comercio lo revise." },
      vendor,
    );
  } catch (err) {
    log.error({ err, orderId: order.id }, "no se pudo confirmar la recepción del comprobante");
  }

  await notifyMerchantForReview(order.id, env, log);
}

/**
 * Mensajes entrantes al sender de UN comercio (no el operador). Nos importan
 * dos tipos: la ubicación compartida para delivery (paso 14) y la foto del
 * comprobante de pago (paso 16). El resto de la conversación de venta la
 * maneja el agente de IA del comercio directamente.
 */
export async function handleVendorMessageInbound(
  rawData: unknown,
  merchantId: string,
  env: Env,
  log: FastifyBaseLogger,
): Promise<void> {
  const data = vendorMessageSchema.parse(rawData);

  if (data.messageType === "location") {
    await handleLocation(data, merchantId, log);
  } else if (data.messageType === "image") {
    await handlePaymentProof(data, merchantId, env, log);
  }
}
