import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getZavuClient } from "../zavu/client.js";

const registroSchema = z.object({
  name: z.string().trim().min(1, "Ingresá el nombre del comercio."),
  ownerPhone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "El teléfono debe estar en formato E.164, ej: +584121234567."),
});

function renderForm(opts: { error?: string } = {}): string {
  const errorHtml = opts.error
    ? `<p style="color:#b00020;margin:0 0 16px;">${opts.error}</p>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vendé por WhatsApp con Zavu</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 64px auto; padding: 0 16px; color: #1a1a1a; }
    h1 { font-size: 1.4rem; }
    p.sub { color: #555; }
    label { display: block; margin-top: 16px; font-weight: 600; }
    input { width: 100%; padding: 10px; margin-top: 4px; box-sizing: border-box; font-size: 1rem; }
    button { margin-top: 24px; width: 100%; padding: 12px; font-size: 1rem; font-weight: 600; background: #25D366; color: white; border: none; border-radius: 6px; cursor: pointer; }
    button:hover { background: #1ebe57; }
  </style>
</head>
<body>
  <h1>Conectá tu WhatsApp y empezá a vender</h1>
  <p class="sub">Cargá tu comercio, conectá tu WhatsApp con un botón y arrancá a vender con ayuda de IA.</p>
  ${errorHtml}
  <form method="POST" action="/registro">
    <label for="name">Nombre del comercio</label>
    <input id="name" name="name" type="text" required placeholder="Arepas La Esquina" />

    <label for="ownerPhone">Tu WhatsApp (con código de país)</label>
    <input id="ownerPhone" name="ownerPhone" type="tel" required placeholder="+584121234567" />

    <button type="submit">Conectar mi WhatsApp</button>
  </form>
</body>
</html>`;
}

export async function registroRoutes(app: FastifyInstance): Promise<void> {
  app.get("/registro", async (_req, reply) => {
    return reply.type("text/html").send(renderForm());
  });

  app.post("/registro", async (req, reply) => {
    const parsed = registroSchema.safeParse(req.body);
    if (!parsed.success) {
      const error = parsed.error.issues[0]?.message ?? "Datos inválidos.";
      return reply.code(400).type("text/html").send(renderForm({ error }));
    }

    const { name, ownerPhone } = parsed.data;
    const zavu = getZavuClient(app.env.ZAVU_API_KEY);

    try {
      const existing = await prisma.merchant.findUnique({ where: { ownerPhone } });

      if (existing) {
        if (existing.status === "ACTIVO") {
          return reply
            .code(400)
            .type("text/html")
            .send(renderForm({ error: "Ese WhatsApp ya está conectado a un comercio activo." }));
        }

        if (existing.zavuInvitationId) {
          const { invitation } = await zavu.invitations.retrieve(existing.zavuInvitationId);
          if (
            invitation.status === "pending" ||
            invitation.status === "in_progress" ||
            invitation.status === "failed"
          ) {
            return reply.redirect(invitation.url, 302);
          }
        }
      }

      const { invitation } = await zavu.invitations.create({
        clientName: name,
        clientPhone: ownerPhone,
        connectionType: "whatsapp_waba",
      });

      if (existing) {
        await prisma.merchant.update({
          where: { id: existing.id },
          data: { name, zavuInvitationId: invitation.id, status: "PENDIENTE_CONEXION" },
        });
      } else {
        await prisma.merchant.create({
          data: {
            name,
            ownerPhone,
            status: "PENDIENTE_CONEXION",
            zavuInvitationId: invitation.id,
          },
        });
      }

      return reply.redirect(invitation.url, 302);
    } catch (err) {
      req.log.error(err, "no se pudo crear la invitación de Zavu");
      return reply
        .code(502)
        .type("text/html")
        .send(renderForm({ error: "No pudimos conectar con Zavu. Intentá de nuevo en unos minutos." }));
    }
  });
}
