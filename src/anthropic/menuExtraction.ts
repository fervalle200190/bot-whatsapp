import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropicClient } from "./client.js";

export const MENU_EXTRACTION_MODEL = "claude-opus-5";

const ExtractedMenuSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      priceUsd: z.number(),
    }),
  ),
});

export type ExtractedMenuItem = z.infer<typeof ExtractedMenuSchema>["items"][number];

const EXTRACTION_PROMPT = `Esta es una foto o PDF de un menú o lista de precios de un comercio venezolano.

Extraé cada producto que puedas leer con confianza, con su nombre, una descripción breve si el menú la trae (si no, usá null), y su precio en dólares (USD). Si un precio está en bolívares y no hay forma de saber a qué tasa convertirlo, no inventes una conversión: omití ese producto.

No inventes productos que no estén en la imagen. Si un precio es ilegible, omití ese producto en vez de adivinar.`;

/**
 * Extrae productos de una foto o PDF de menú con Claude vision + salida
 * estructurada. Devuelve base64 crudo — lo descargamos nosotros antes de
 * llamar, en vez de pasarle la URL de Zavu directamente a Anthropic (esa URL
 * puede expirar o no ser públicamente alcanzable desde sus servidores).
 */
export async function extractMenuFromFile(opts: {
  apiKey: string;
  fileBase64: string;
  mimeType: string;
}): Promise<ExtractedMenuItem[]> {
  const client = getAnthropicClient(opts.apiKey);

  const fileBlock = opts.mimeType === "application/pdf"
    ? ({
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: opts.fileBase64 },
      })
    : ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: opts.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: opts.fileBase64,
        },
      });

  const response = await client.messages.parse({
    model: MENU_EXTRACTION_MODEL,
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: EXTRACTION_PROMPT }],
      },
    ],
    output_config: {
      format: zodOutputFormat(ExtractedMenuSchema),
    },
  });

  return response.parsed_output?.items ?? [];
}
