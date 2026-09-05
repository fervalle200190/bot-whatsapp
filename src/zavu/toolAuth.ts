import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyZavuSignature } from "./verify.js";
import { isZavuToolCallEnvelope, type ZavuToolCallEnvelope } from "./toolEnvelope.js";
import type { Env } from "../env.js";

function buildSignatureHeader(req: FastifyRequest): string | undefined {
  const rawSig = req.headers["x-zavu-signature"];
  const sig = Array.isArray(rawSig) ? rawSig[0] : rawSig;
  if (!sig) return undefined;
  if (sig.includes("t=")) return sig;

  const rawTs = req.headers["x-zavu-timestamp"];
  const ts = Array.isArray(rawTs) ? rawTs[0] : rawTs;
  if (!ts) return undefined;
  return `t=${ts},v2=${sig}`;
}

/**
 * Verifica el sobre y la firma de una tool call. Devuelve el sobre si es
 * válido, o `null` después de ya haber respondido el error correspondiente
 * (payload inválido → 400, firma inválida → 401).
 */
export function authenticateToolCall(
  req: FastifyRequest,
  reply: FastifyReply,
  env: Env,
): ZavuToolCallEnvelope | null {
  const body = req.body;

  if (!isZavuToolCallEnvelope(body)) {
    reply.code(400).send({ error: "payload_invalido" });
    return null;
  }

  const header = buildSignatureHeader(req);
  const rawBody = req.rawBody?.toString("utf8") ?? "";

  if (!verifyZavuSignature(rawBody, header, env.ZAVU_TOOLS_WEBHOOK_SECRET)) {
    req.log.warn({ tool: body.tool }, "firma de tool call inválida");
    reply.code(401).send({ error: "firma_invalida" });
    return null;
  }

  return body;
}
