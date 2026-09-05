import { z } from "zod";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { getZavuClient } from "../client.js";
import { buildVendorSystemPrompt } from "../prompts.js";
import type { Env } from "../../env.js";

const invitationStatusChangedDataSchema = z.object({
  invitationId: z.string(),
  currentStatus: z.enum(["pending", "in_progress", "completed", "cancelled", "failed"]),
  previousStatus: z.enum(["pending", "in_progress", "completed", "cancelled", "failed"]),
  senderId: z.string().optional(),
});

/**
 * Activa un comercio cuando su Partner Invitation se completa: configura el
 * webhook DE ESE sender (cada uno tiene su propio secreto — spec sección 6),
 * guarda el secreto y pasa el Merchant a ACTIVO.
 */
export async function handleInvitationStatusChanged(
  rawData: unknown,
  env: Env,
  log: FastifyBaseLogger,
): Promise<void> {
  const data = invitationStatusChangedDataSchema.parse(rawData);

  if (data.currentStatus !== "completed" || !data.senderId) {
    log.info(
      { invitationId: data.invitationId, status: data.currentStatus },
      "invitación sin completar todavía, nada que activar",
    );
    return;
  }

  const merchant = await prisma.merchant.findUnique({
    where: { zavuInvitationId: data.invitationId },
  });

  if (!merchant) {
    log.warn({ invitationId: data.invitationId }, "invitación completada sin Merchant asociado");
    return;
  }

  const zavu = getZavuClient(env.ZAVU_API_KEY);
  const webhookUrl = `${env.PUBLIC_BASE_URL}/webhooks/zavu`;

  await zavu.senders.update(data.senderId, {
    webhookUrl,
    webhookEvents: ["message.inbound", "message.status"],
    webhookSignatureVersion: "v2",
  });

  const { secret } = await zavu.senders.regenerateWebhookSecret(data.senderId);

  const { agent } = await zavu.senders.agent.create(data.senderId, {
    name: `Vendedor ${merchant.name}`,
    provider: "anthropic",
    model: "claude-opus-5",
    systemPrompt: buildVendorSystemPrompt(merchant.name),
    apiKey: env.ANTHROPIC_API_KEY,
  });

  // El comprador que llama a esta tool no es el dueño del comercio, así que
  // contactPhone no sirve para identificarlo (a diferencia de las tools del
  // operador). En vez de confiar en algo que genere el modelo, el merchantId
  // va incrustado en la URL de ESTA copia puntual de la tool — la fija
  // nuestro propio backend al crearla, nunca el LLM.
  await zavu.senders.agent.tools.create(data.senderId, {
    name: "buscar_productos",
    description:
      "Busca productos disponibles del catálogo de este comercio. Llamala cuando el comprador pregunte qué venden, pida ver el menú, o busque algo puntual.",
    parameters: {
      type: "object",
      properties: {
        termino: {
          type: "string",
          description: "Palabra o frase para filtrar productos por nombre o descripción. Omitilo para traer todo el catálogo disponible.",
        },
      },
      required: [],
    },
    webhookUrl: `${env.PUBLIC_BASE_URL}/tools/catalogo/buscar?merchantId=${merchant.id}`,
    webhookSecret: env.ZAVU_TOOLS_WEBHOOK_SECRET,
  });

  await zavu.senders.agent.tools.create(data.senderId, {
    name: "agregar_al_carrito",
    description:
      "Agrega una cantidad de un producto del catálogo al carrito del comprador. Llamala cada vez que el comprador pida un producto puntual.",
    parameters: {
      type: "object",
      properties: {
        nombreProducto: { type: "string", description: "Nombre del producto, tal como aparece en el catálogo" },
        cantidad: { type: "number", description: "Cuántas unidades. Si no lo dice, asumí 1." },
      },
      required: ["nombreProducto"],
    },
    webhookUrl: `${env.PUBLIC_BASE_URL}/tools/carrito/agregar?merchantId=${merchant.id}`,
    webhookSecret: env.ZAVU_TOOLS_WEBHOOK_SECRET,
  });

  await zavu.senders.agent.tools.create(data.senderId, {
    name: "ver_carrito",
    description: "Devuelve los ítems actuales del carrito del comprador y el total en USD y en bolívares.",
    parameters: { type: "object", properties: {}, required: [] },
    webhookUrl: `${env.PUBLIC_BASE_URL}/tools/carrito/ver?merchantId=${merchant.id}`,
    webhookSecret: env.ZAVU_TOOLS_WEBHOOK_SECRET,
  });

  await zavu.senders.agent.tools.create(data.senderId, {
    name: "definir_entrega",
    description:
      "Fija si el comprador retira en el local o pide delivery. Llamala apenas el comprador lo diga. Si es delivery, esta herramienta ya le pide la ubicación por WhatsApp — no se la pidas vos también.",
    parameters: {
      type: "object",
      properties: {
        tipo: { type: "string", description: "Exactamente 'RETIRO' o 'DELIVERY', en mayúsculas" },
      },
      required: ["tipo"],
    },
    webhookUrl: `${env.PUBLIC_BASE_URL}/tools/orden/entrega?merchantId=${merchant.id}`,
    webhookSecret: env.ZAVU_TOOLS_WEBHOOK_SECRET,
  });

  await zavu.senders.agent.tools.create(data.senderId, {
    name: "cerrar_orden",
    description:
      "Cierra el pedido: congela el total, y le manda al comprador los datos de cobro con el monto en bolívares. Llamala solo cuando el comprador ya terminó de pedir y ya definió retiro o delivery (con ubicación si aplica).",
    parameters: { type: "object", properties: {}, required: [] },
    webhookUrl: `${env.PUBLIC_BASE_URL}/tools/orden/cerrar?merchantId=${merchant.id}`,
    webhookSecret: env.ZAVU_TOOLS_WEBHOOK_SECRET,
  });

  await prisma.merchant.update({
    where: { id: merchant.id },
    data: {
      zavuSenderId: data.senderId,
      zavuSenderWebhookSecret: secret,
      zavuAgentId: agent.id,
      status: "ACTIVO",
    },
  });

  log.info(
    { merchantId: merchant.id, senderId: data.senderId, agentId: agent.id },
    "comercio activado y agente vendedor creado",
  );
}
