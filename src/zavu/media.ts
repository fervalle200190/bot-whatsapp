import { getZavuClient } from "./client.js";

const MEDIA_POLL_ATTEMPTS = 5;
const MEDIA_POLL_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * El webhook de un mensaje de imagen/documento trae `content.mediaId` al
 * principio; `content.mediaUrl` lo reemplaza "en lecturas posteriores del
 * mensaje" según la doc de Zavu, sin garantizar cuándo. Polling acotado con
 * timeout explícito — ver spec sección 6.
 */
export async function resolveMediaUrl(
  zavu: ReturnType<typeof getZavuClient>,
  messageId: string,
  initialUrl: string | undefined,
): Promise<string | undefined> {
  if (initialUrl) return initialUrl;

  for (let attempt = 0; attempt < MEDIA_POLL_ATTEMPTS; attempt++) {
    await sleep(MEDIA_POLL_DELAY_MS);
    const { message } = await zavu.messages.retrieve(messageId);
    if (message.content?.mediaUrl) return message.content.mediaUrl;
  }

  return undefined;
}
