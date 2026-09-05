import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { Env } from "./env.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { registroRoutes } from "./routes/registro.js";
import { toolRoutes } from "./routes/tools.js";

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: "info",
      redact: [
        "req.headers.authorization",
        "req.headers['x-zavu-signature']",
        "*.zavuSenderWebhookSecret",
        "*.apiKey",
      ],
    },
  });

  app.decorate("env", env);

  app.get("/health", async () => {
    return { status: "ok" };
  });

  await app.register(formbody);
  await app.register(registroRoutes);
  await app.register(webhookRoutes, { prefix: "/webhooks" });
  await app.register(toolRoutes, { prefix: "/tools" });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
  }
}
