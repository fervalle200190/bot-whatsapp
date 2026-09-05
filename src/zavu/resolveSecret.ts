import { prisma } from "../lib/prisma.js";
import type { Env } from "../env.js";

export interface ResolvedSender {
  /** "operador" para el número compartido de Zavu, "comercio" para el sender de un Merchant. */
  kind: "operador" | "comercio";
  secret: string;
  merchantId: string | null;
}

/**
 * Resuelve qué secreto usar para verificar la firma de un evento, a partir del
 * senderId (sin verificar todavía) que trae el propio sobre del webhook.
 * No hay secreto global: cada sender tiene el suyo (spec sección 6).
 */
export async function resolveSenderSecret(
  senderId: string,
  env: Env,
): Promise<ResolvedSender | null> {
  if (senderId === env.ZAVU_OPERATOR_SENDER_ID) {
    return { kind: "operador", secret: env.ZAVU_OPERATOR_WEBHOOK_SECRET, merchantId: null };
  }

  const merchant = await prisma.merchant.findUnique({
    where: { zavuSenderId: senderId },
    select: { id: true, zavuSenderWebhookSecret: true },
  });

  if (!merchant?.zavuSenderWebhookSecret) return null;

  return { kind: "comercio", secret: merchant.zavuSenderWebhookSecret, merchantId: merchant.id };
}
