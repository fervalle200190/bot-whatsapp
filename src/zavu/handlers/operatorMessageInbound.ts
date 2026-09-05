import { z } from "zod";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { getZavuClient, withSender } from "../client.js";
import { extractMenuFromFile, MENU_EXTRACTION_MODEL } from "../../anthropic/menuExtraction.js";
import { resolveMediaUrl } from "../media.js";
import { safeSend } from "../safeSend.js";
import { handlePaymentDecision } from "./paymentDecision.js";
import type { Env } from "../../env.js";

const messageInboundDataSchema = z
  .object({
    messageId: z.string(),
    from: z.string(),
    messageType: z.string(),
    content: z
      .object({
        mediaId: z.string().optional(),
        mediaUrl: z.string().optional(),
        mimeType: z.string().optional(),
        interactiveReply: z
          .object({
            type: z.string(),
            id: z.string(),
            title: z.string(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

async function downloadAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar el archivo del menú (status ${res.status})`);
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { base64: buffer.toString("base64"), mimeType };
}

function formatExtractedItems(items: { name: string; description: string | null; priceUsd: number }[]): string {
  return items
    .map((item, i) => {
      const desc = item.description ? ` — ${item.description}` : "";
      return `${i + 1}. ${item.name}${desc} — $${item.priceUsd.toFixed(2)}`;
    })
    .join("\n");
}

/**
 * Maneja fotos/PDF de menú enviados al número OPERADOR. Solo actúa sobre
 * messageType image/document — el resto (texto) lo maneja el agente de IA
 * del operador directamente, no este handler.
 */
export async function handleOperatorMessageInbound(
  rawData: unknown,
  env: Env,
  log: FastifyBaseLogger,
): Promise<void> {
  const data = messageInboundDataSchema.parse(rawData);

  if (data.content?.interactiveReply?.type === "button_reply") {
    await handlePaymentDecision(data.content.interactiveReply.id, data.from, env, log);
    return;
  }

  if (data.messageType !== "image" && data.messageType !== "document") {
    return;
  }

  const zavu = getZavuClient(env.ZAVU_API_KEY);
  const operator = withSender(env.ZAVU_OPERATOR_SENDER_ID);

  const merchant = await prisma.merchant.findUnique({ where: { ownerPhone: data.from } });

  if (!merchant || merchant.status !== "ACTIVO") {
    await safeSend(
      zavu,
      {
        to: data.from,
        text: `Todavía no tenés un comercio registrado. Registrate acá: ${env.PUBLIC_BASE_URL}/registro`,
      },
      operator,
      log,
    );
    return;
  }

  const mediaUrl = await resolveMediaUrl(zavu, data.messageId, data.content?.mediaUrl);

  if (!mediaUrl) {
    log.warn({ merchantId: merchant.id, messageId: data.messageId }, "no se pudo obtener mediaUrl del menú");
    await safeSend(zavu, { to: data.from, text: "No pude descargar la imagen. ¿Podés reenviarla?" }, operator, log);
    return;
  }

  const menuImport = await prisma.menuImport.create({
    data: {
      merchantId: merchant.id,
      sourceUrl: mediaUrl,
      status: "EXTRAYENDO",
      extracted: [],
      model: MENU_EXTRACTION_MODEL,
    },
  });

  try {
    const { base64, mimeType } = await downloadAsBase64(mediaUrl);
    const items = await extractMenuFromFile({ apiKey: env.ANTHROPIC_API_KEY, fileBase64: base64, mimeType });

    if (items.length === 0) {
      await prisma.menuImport.update({
        where: { id: menuImport.id },
        data: { status: "DESCARTADO" },
      });
      await safeSend(
        zavu,
        { to: data.from, text: "No pude leer ningún producto con precio en esa imagen. ¿Podés mandar una más clara?" },
        operator,
        log,
      );
      return;
    }

    await prisma.menuImport.update({
      where: { id: menuImport.id },
      data: { status: "ESPERANDO_CONFIRMACION", extracted: items },
    });

    await safeSend(
      zavu,
      {
        to: data.from,
        text: `Encontré estos productos:\n\n${formatExtractedItems(items)}\n\n¿Los cargo así, o querés corregir algo?`,
      },
      operator,
      log,
    );
  } catch (err) {
    log.error({ err, menuImportId: menuImport.id }, "falló la extracción del menú");
    await prisma.menuImport.update({
      where: { id: menuImport.id },
      data: { status: "DESCARTADO" },
    });
    await safeSend(
      zavu,
      { to: data.from, text: "Tuve un problema leyendo el menú. Intentá de nuevo en un rato." },
      operator,
      log,
    );
  }
}
