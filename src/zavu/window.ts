import { getZavuClient } from "./client.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Heurística best-effort: mira el último mensaje del hilo entre ESE sender y
 * ESE contacto. Si fue un mensaje del contacto (inbound) hace menos de 24h,
 * asumimos la ventana abierta. Cualquier otro caso (último mensaje nuestro,
 * hilo inexistente, o error de red) se trata como cerrada — es la opción
 * segura que nunca intenta un mensaje libre que WhatsApp va a rechazar.
 *
 * No hay forma de confirmar esto sin una cuenta real de Zavu conectada — ver
 * spec sección 6/7 para la limitación conocida.
 */
export async function isWindowOpenForContact(
  zavu: ReturnType<typeof getZavuClient>,
  senderId: string,
  contactPhone: string,
): Promise<boolean> {
  try {
    const result = await zavu.conversations.list({ senderId, search: contactPhone });
    const convo = result.items[0];

    if (!convo?.lastMessage || convo.lastMessage.direction !== "inbound") {
      return false;
    }

    const age = Date.now() - new Date(convo.lastMessage.at).getTime();
    return age < WINDOW_MS;
  } catch {
    return false;
  }
}
