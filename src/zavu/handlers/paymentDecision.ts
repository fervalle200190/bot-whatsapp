import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { getZavuClient, withSender } from "../client.js";
import { safeSend } from "../safeSend.js";
import { approveButtonId, rejectButtonId } from "./paymentReview.js";
import type { Env } from "../../env.js";

function parseDecisionButton(buttonId: string): { orderId: string; approved: boolean } | null {
  if (buttonId.startsWith("aprobar_")) {
    return { orderId: buttonId.slice("aprobar_".length), approved: true };
  }
  if (buttonId.startsWith("rechazar_")) {
    return { orderId: buttonId.slice("rechazar_".length), approved: false };
  }
  return null;
}

/**
 * Procesa el click de Aprobar/Rechazar que llega al número OPERADOR. El
 * botón solo trae el orderId — quien escribe (`fromOwnerPhone`) tiene que
 * ser efectivamente el dueño del comercio DE ESA orden, si no se ignora.
 * Sin esto, cualquiera que le escriba al operador y adivine/reciba un
 * botón de otro comercio podría decidir sobre un pedido ajeno.
 */
export async function handlePaymentDecision(
  buttonId: string,
  fromOwnerPhone: string,
  env: Env,
  log: FastifyBaseLogger,
): Promise<void> {
  const parsed = parseDecisionButton(buttonId);
  if (!parsed) return;

  const order = await prisma.order.findUnique({
    where: { id: parsed.orderId },
    include: { merchant: true, proofs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const proof = order?.proofs[0];
  if (!order || !proof) {
    log.warn({ orderId: parsed.orderId }, "botón de decisión para una orden inexistente");
    return;
  }

  if (order.merchant.ownerPhone !== fromOwnerPhone) {
    log.warn(
      { orderId: order.id, fromOwnerPhone, expectedOwnerPhone: order.merchant.ownerPhone },
      "intento de decidir sobre una orden que no pertenece a quien escribe",
    );
    return;
  }

  if (order.status !== "PAGO_EN_REVISION") {
    const zavu = getZavuClient(env.ZAVU_API_KEY);
    await safeSend(
      zavu,
      { to: fromOwnerPhone, text: "Ese pedido ya estaba resuelto." },
      withSender(env.ZAVU_OPERATOR_SENDER_ID),
      log,
    );
    return;
  }

  const newStatus = parsed.approved ? "APROBADA" : "RECHAZADA";
  const newDecision = parsed.approved ? "APROBADO" : "RECHAZADO";

  await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { status: newStatus } }),
    prisma.paymentProof.update({
      where: { id: proof.id },
      data: { decision: newDecision, decidedAt: new Date() },
    }),
  ]);

  log.info({ orderId: order.id, newStatus }, "decisión de pago aplicada");

  const zavu = getZavuClient(env.ZAVU_API_KEY);

  await safeSend(
    zavu,
    { to: fromOwnerPhone, text: `Listo, marcado como ${parsed.approved ? "aprobado" : "rechazado"}.` },
    withSender(env.ZAVU_OPERATOR_SENDER_ID),
    log,
  );

  if (order.merchant.zavuSenderId) {
    const buyerText = parsed.approved
      ? "¡Tu pago fue confirmado! Ya estamos preparando tu pedido."
      : "Tu comprobante fue rechazado. Si creés que es un error, respondé este mensaje.";
    await safeSend(zavu, { to: order.buyerPhone, text: buyerText }, withSender(order.merchant.zavuSenderId), log);
  }
}
