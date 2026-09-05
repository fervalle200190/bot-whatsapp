import type { FastifyInstance } from "fastify";
import { verifyZavuSignature, isZavuWebhookEnvelope } from "../zavu/verify.js";
import { resolveSenderSecret } from "../zavu/resolveSecret.js";
import { handleInvitationStatusChanged } from "../zavu/handlers/invitationStatusChanged.js";
import { handleOperatorMessageInbound } from "../zavu/handlers/operatorMessageInbound.js";
import { handleVendorMessageInbound } from "../zavu/handlers/vendorMessageInbound.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/**
 * Registrado en un plugin encapsulado propio: el parser de body crudo que
 * define acá solo aplica a las rutas registradas en este mismo plugin, no al
 * resto de la app (por ejemplo /registro sigue usando el parser normal).
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      const buffer = body as Buffer;
      req.rawBody = buffer;
      try {
        const json: unknown = buffer.length > 0 ? JSON.parse(buffer.toString("utf8")) : {};
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post("/zavu", async (req, reply) => {
    const body = req.body;

    if (!isZavuWebhookEnvelope(body)) {
      return reply.code(400).send({ error: "payload_invalido" });
    }

    const resolved = await resolveSenderSecret(body.senderId, app.env);
    if (!resolved) {
      req.log.warn({ senderId: body.senderId }, "webhook de sender desconocido");
      return reply.code(401).send({ error: "sender_desconocido" });
    }

    const signatureHeader = req.headers["x-zavu-signature"];
    const rawBody = req.rawBody?.toString("utf8") ?? "";
    const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!verifyZavuSignature(rawBody, header, resolved.secret)) {
      req.log.warn({ senderId: body.senderId }, "firma de webhook inválida");
      return reply.code(401).send({ error: "firma_invalida" });
    }

    req.log.info({ type: body.type, senderId: body.senderId }, "webhook de zavu verificado");

    try {
      switch (body.type) {
        case "invitation.status_changed":
          await handleInvitationStatusChanged(body.data, app.env, req.log);
          break;
        case "message.inbound":
          if (resolved.kind === "operador") {
            await handleOperatorMessageInbound(body.data, app.env, req.log);
          } else if (resolved.merchantId) {
            await handleVendorMessageInbound(body.data, resolved.merchantId, app.env, req.log);
          }
          break;
        default:
          req.log.info({ type: body.type }, "evento de zavu sin handler todavía, ignorado");
      }
    } catch (err) {
      req.log.error({ err, type: body.type }, "error procesando evento de zavu");
      return reply.code(500).send({ error: "error_interno" });
    }

    return reply.code(200).send({ received: true });
  });
}
