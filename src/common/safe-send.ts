import type { Logger } from '@nestjs/common';

/**
 * Envuelve un envío de mensajería para que una falla (fuera de la ventana de
 * 24h, Meta caído, etc.) nunca deshaga una decisión ya aplicada: se loguea,
 * no se relanza.
 */
export async function safeSend(send: () => Promise<void>, logger: Logger, context: string): Promise<void> {
  try {
    await send();
  } catch (err) {
    logger.error(err, `safeSend: no se pudo enviar el aviso (${context})`);
  }
}
