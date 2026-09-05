import Zavudev from "@zavudev/sdk";

let cachedClient: Zavudev | undefined;

/**
 * Un solo cliente para todo el proyecto: no hay Sub-Accounts (ver spec sección 6,
 * decisión "No: aislar cada comercio en su propia Sub-Account de Zavu").
 */
export function getZavuClient(apiKey: string): Zavudev {
  if (!cachedClient) {
    cachedClient = new Zavudev({ apiKey });
  }
  return cachedClient;
}

/**
 * Envía un mensaje desde un sender específico. El sender se selecciona con el
 * header `Zavu-Sender`, no con un campo del body (confirmado en el SDK).
 */
export function withSender(senderId: string) {
  return { headers: { "Zavu-Sender": senderId } };
}
