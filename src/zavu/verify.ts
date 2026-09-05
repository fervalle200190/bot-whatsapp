import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 300;
const MAX_CLOCK_SKEW_SECONDS = 60;

interface SignatureParts {
  t?: string;
  v1?: string;
  v2?: string;
}

function parseSignatureHeader(header: string): SignatureParts {
  const parts: SignatureParts = {};
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i > 0) {
      const key = piece.slice(0, i).trim();
      const value = piece.slice(i + 1).trim();
      if (key === "t" || key === "v1" || key === "v2") {
        parts[key] = value;
      }
    }
  }
  return parts;
}

/**
 * Verifica la firma X-Zavu-Signature (esquema v2, o v1 como fallback) contra
 * el body crudo. El secreto es siempre el de UN sender puntual — nunca hay un
 * secreto global de proyecto (ver spec sección 6).
 */
export function verifyZavuSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;

  const parts = parseSignatureHeader(header);
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const age = nowSeconds - timestamp;
  if (age > MAX_AGE_SECONDS || age < -MAX_CLOCK_SKEW_SECONDS) return false;

  const received = parts.v2 ?? parts.v1;
  if (!received) return false;
  const signedPayload = parts.v2 ? `${parts.t}.${rawBody}` : rawBody;

  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");

  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export interface ZavuWebhookEnvelope {
  id: string;
  type: string;
  timestamp: number;
  senderId: string;
  projectId: string;
  data: unknown;
}

/** Type guard mínimo: solo lo necesario para resolver a qué secreto validar. */
export function isZavuWebhookEnvelope(value: unknown): value is ZavuWebhookEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).senderId === "string" &&
    typeof (value as Record<string, unknown>).type === "string"
  );
}
