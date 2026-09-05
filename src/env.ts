import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().min(1),
  ZAVU_API_KEY: z.string().min(1),
  ZAVU_OPERATOR_SENDER_ID: z.string().min(1),
  ZAVU_OPERATOR_WEBHOOK_SECRET: z.string().min(1),
  ZAVU_TOOLS_WEBHOOK_SECRET: z.string().min(1),
  ZAVU_PAGO_EN_REVISION_TEMPLATE_ID: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variables de entorno inválidas o faltantes:\n${issues}`);
  }
  return parsed.data;
}
