export interface ZavuToolCallEnvelope {
  tool: string;
  arguments: Record<string, unknown>;
  context: {
    messageId: string;
    contactPhone: string;
    sessionId: string;
  };
  timestamp: number;
}

/**
 * Type guard mínimo para el payload de una tool call. No confiamos en
 * `arguments` para identidad — solo en `context.contactPhone`, que pone Zavu.
 */
export function isZavuToolCallEnvelope(value: unknown): value is ZavuToolCallEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.tool !== "string") return false;
  if (typeof v.context !== "object" || v.context === null) return false;
  const context = v.context as Record<string, unknown>;
  return typeof context.contactPhone === "string";
}
