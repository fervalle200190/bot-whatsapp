import type { FastifyBaseLogger } from "fastify";
import { getZavuClient, withSender } from "./client.js";

/**
 * Los mensajes enviados con esta función son avisos post-hecho (ya escribimos
 * en la base o ya decidimos qué hacer): si el envío falla, se loguea pero NO
 * se relanza. Dejar que se propague causaría un 500 al webhook de Zavu, que
 * reintentaría TODO el evento — repitiendo trabajo ya hecho, que es peor que
 * perder un mensaje de WhatsApp puntual.
 */
export async function safeSend(
  zavu: ReturnType<typeof getZavuClient>,
  params: Parameters<ReturnType<typeof getZavuClient>["messages"]["send"]>[0],
  sender: ReturnType<typeof withSender>,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    await zavu.messages.send(params, sender);
  } catch (err) {
    log.error({ err, to: params.to }, "no se pudo enviar el mensaje de WhatsApp");
  }
}
