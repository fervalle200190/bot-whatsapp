import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateToolCall } from "../zavu/toolAuth.js";
import { prisma } from "../lib/prisma.js";
import { getOrCreateDraftOrder, buildCartSnapshot } from "../lib/cart.js";
import { getZavuClient, withSender } from "../zavu/client.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const editarProductoArgsSchema = z.object({
  nombreActual: z.string(),
  nuevoNombre: z.string().optional(),
  nuevoPrecioUsd: z.number().optional(),
  nuevaDescripcion: z.string().optional(),
});

const actualizarTasaArgsSchema = z.object({
  tasaBsPorUsd: z.number().positive(),
});

const guardarDatosCobroArgsSchema = z.object({
  datosCobro: z.string().trim().min(1),
});

const buscarProductosArgsSchema = z.object({
  termino: z.string().trim().optional(),
});

const buscarProductosQuerySchema = z.object({
  merchantId: z.string().min(1),
});

const agregarAlCarritoArgsSchema = z.object({
  nombreProducto: z.string().trim().min(1),
  cantidad: z.number().int().positive().default(1),
});

const definirEntregaArgsSchema = z.object({
  tipo: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.enum(["RETIRO", "DELIVERY"])),
});

/**
 * Plugin encapsulado propio, con su propio parser de body crudo — igual
 * patrón que webhookRoutes, para no interferir con /registro.
 */
export async function toolRoutes(app: FastifyInstance): Promise<void> {
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

  app.post("/comercio/identificar", async (req, reply) => {
    const call = authenticateToolCall(req, reply, app.env);
    if (!call) return;

    const merchant = await prisma.merchant.findUnique({
      where: { ownerPhone: call.context.contactPhone },
      select: { name: true, status: true },
    });

    if (!merchant || merchant.status !== "ACTIVO") {
      return reply.code(200).send({
        found: false,
        registroUrl: `${app.env.PUBLIC_BASE_URL}/registro`,
      });
    }

    return reply.code(200).send({ found: true, merchantName: merchant.name });
  });

  app.post("/menu/confirmar", async (req, reply) => {
    const call = authenticateToolCall(req, reply, app.env);
    if (!call) return;

    const merchant = await prisma.merchant.findUnique({
      where: { ownerPhone: call.context.contactPhone },
    });

    if (!merchant || merchant.status !== "ACTIVO") {
      return reply.code(200).send({ error: "comercio_no_encontrado" });
    }

    const pending = await prisma.menuImport.findFirst({
      where: { merchantId: merchant.id, status: "ESPERANDO_CONFIRMACION" },
      orderBy: { createdAt: "desc" },
    });

    if (!pending) {
      return reply.code(200).send({ error: "no_hay_menu_pendiente" });
    }

    const items = pending.extracted as { name: string; description: string | null; priceUsd: number }[];

    await prisma.$transaction([
      prisma.product.createMany({
        data: items.map((item) => ({
          merchantId: merchant.id,
          name: item.name,
          description: item.description,
          priceUsd: item.priceUsd,
          available: true,
          source: "EXTRACCION_FOTO" as const,
        })),
      }),
      prisma.menuImport.update({
        where: { id: pending.id },
        data: { status: "CONFIRMADO" },
      }),
    ]);

    return reply.code(200).send({ confirmed: true, count: items.length });
  });

  app.post("/producto/editar", async (req, reply) => {
    const call = authenticateToolCall(req, reply, app.env);
    if (!call) return;

    const args = editarProductoArgsSchema.safeParse(call.arguments);
    if (!args.success) {
      return reply.code(200).send({ error: "argumentos_invalidos" });
    }

    const merchant = await prisma.merchant.findUnique({
      where: { ownerPhone: call.context.contactPhone },
    });

    if (!merchant || merchant.status !== "ACTIVO") {
      return reply.code(200).send({ error: "comercio_no_encontrado" });
    }

    const pending = await prisma.menuImport.findFirst({
      where: { merchantId: merchant.id, status: "ESPERANDO_CONFIRMACION" },
      orderBy: { createdAt: "desc" },
    });

    if (!pending) {
      return reply.code(200).send({ error: "no_hay_menu_pendiente" });
    }

    const items = pending.extracted as { name: string; description: string | null; priceUsd: number }[];
    const index = items.findIndex(
      (item) => item.name.trim().toLowerCase() === args.data.nombreActual.trim().toLowerCase(),
    );

    if (index === -1) {
      return reply.code(200).send({ error: "producto_no_encontrado_en_la_lista" });
    }

    const current = items[index]!;
    const updated = {
      name: args.data.nuevoNombre ?? current.name,
      description: args.data.nuevaDescripcion ?? current.description,
      priceUsd: args.data.nuevoPrecioUsd ?? current.priceUsd,
    };
    const newItems = [...items];
    newItems[index] = updated;

    await prisma.menuImport.update({
      where: { id: pending.id },
      data: { extracted: newItems },
    });

    return reply.code(200).send({ updated: true, item: updated });
  });

  app.post("/tasa/actualizar", async (req, reply) => {
    const call = authenticateToolCall(req, reply, app.env);
    if (!call) return;

    const args = actualizarTasaArgsSchema.safeParse(call.arguments);
    if (!args.success) {
      return reply.code(200).send({ error: "argumentos_invalidos" });
    }

    const merchant = await prisma.merchant.findUnique({
      where: { ownerPhone: call.context.contactPhone },
    });

    if (!merchant || merchant.status !== "ACTIVO") {
      return reply.code(200).send({ error: "comercio_no_encontrado" });
    }

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { vesRate: args.data.tasaBsPorUsd, vesRateUpdatedAt: new Date() },
    });

    return reply.code(200).send({ updated: true, vesRate: args.data.tasaBsPorUsd });
  });

  app.post("/cobro/guardar", async (req, reply) => {
    const call = authenticateToolCall(req, reply, app.env);
    if (!call) return;

    const args = guardarDatosCobroArgsSchema.safeParse(call.arguments);
    if (!args.success) {
      return reply.code(200).send({ error: "argumentos_invalidos" });
    }

    const merchant = await prisma.merchant.findUnique({
      where: { ownerPhone: call.context.contactPhone },
    });

    if (!merchant || merchant.status !== "ACTIVO") {
      return reply.code(200).send({ error: "comercio_no_encontrado" });
    }

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { payoutInstructions: args.data.datosCobro },
    });

    return reply.code(200).send({ updated: true });
  });

  app.post("/catalogo/buscar", async (req, reply) => {
    const call = authenticateToolCall(req, reply, app.env);
    if (!call) return;

    const query = buscarProductosQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: "merchantId_faltante" });
    }

    const args = buscarProductosArgsSchema.safeParse(call.arguments);
    if (!args.success) {
      return reply.code(200).send({ error: "argumentos_invalidos" });
    }

    const termino = args.data.termino;
    const products = await prisma.product.findMany({
      where: {
        merchantId: query.data.merchantId,
        available: true,
        ...(termino
          ? {
              OR: [
                { name: { contains: termino, mode: "insensitive" } },
                { description: { contains: termino, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { name: true, description: true, priceUsd: true },
      orderBy: { name: "asc" },
    });

    return reply.code(200).send({
      productos: products.map((p) => ({
        nombre: p.name,
        descripcion: p.description,
        precioUsd: Number(p.priceUsd),
      })),
    });
  });

  app.post("/carrito/agregar", async (req, reply) => {
    const call = authenticateToolCall(req, reply, app.env);
    if (!call) return;

    const query = buscarProductosQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: "merchantId_faltante" });
    }

    const args = agregarAlCarritoArgsSchema.safeParse(call.arguments);
    if (!args.success) {
      return reply.code(200).send({ error: "argumentos_invalidos" });
    }

    const product = await prisma.product.findFirst({
      where: {
        merchantId: query.data.merchantId,
        available: true,
        name: { equals: args.data.nombreProducto, mode: "insensitive" },
      },
    });

    if (!product) {
      return reply.code(200).send({ error: "producto_no_encontrado" });
    }

    const order = await getOrCreateDraftOrder(query.data.merchantId, call.context.contactPhone);

    const existingItem = await prisma.orderItem.findFirst({
      where: { orderId: order.id, productId: product.id },
    });

    if (existingItem) {
      await prisma.orderItem.update({
        where: { id: existingItem.id },
        data: { qty: existingItem.qty + args.data.cantidad },
      });
    } else {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          nameSnapshot: product.name,
          unitPriceUsd: product.priceUsd,
          qty: args.data.cantidad,
        },
      });
    }

    const cart = await buildCartSnapshot(order.id, query.data.merchantId);
    return reply.code(200).send({ agregado: true, carrito: cart });
  });

  app.post("/carrito/ver", async (req, reply) => {
    const call = authenticateToolCall(req, reply, app.env);
    if (!call) return;

    const query = buscarProductosQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: "merchantId_faltante" });
    }

    const order = await prisma.order.findFirst({
      where: { merchantId: query.data.merchantId, buyerPhone: call.context.contactPhone, status: "BORRADOR" },
    });

    if (!order) {
      const merchant = await prisma.merchant.findUnique({
        where: { id: query.data.merchantId },
        select: { vesRate: true },
      });
      return reply.code(200).send({
        carrito: { items: [], totalUsd: 0, totalVes: merchant?.vesRate ? 0 : null },
      });
    }

    const cart = await buildCartSnapshot(order.id, query.data.merchantId);
    return reply.code(200).send({ carrito: cart });
  });

  app.post("/orden/entrega", async (req, reply) => {
    const call = authenticateToolCall(req, reply, app.env);
    if (!call) return;

    const query = buscarProductosQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: "merchantId_faltante" });
    }

    const args = definirEntregaArgsSchema.safeParse(call.arguments);
    if (!args.success) {
      return reply.code(200).send({ error: "argumentos_invalidos" });
    }

    const merchant = await prisma.merchant.findUnique({ where: { id: query.data.merchantId } });
    if (!merchant || !merchant.zavuSenderId) {
      return reply.code(200).send({ error: "comercio_no_encontrado" });
    }

    const order = await getOrCreateDraftOrder(query.data.merchantId, call.context.contactPhone);

    await prisma.order.update({
      where: { id: order.id },
      data: { fulfillment: args.data.tipo },
    });

    if (args.data.tipo === "RETIRO") {
      return reply.code(200).send({ definido: true, tipo: "RETIRO" });
    }

    const zavu = getZavuClient(app.env.ZAVU_API_KEY);
    try {
      await zavu.messages.send(
        {
          to: call.context.contactPhone,
          messageType: "location_request",
          text: "Compartinos tu ubicación para coordinar el envío 📍",
        },
        withSender(merchant.zavuSenderId),
      );
    } catch (err) {
      req.log.error({ err, orderId: order.id }, "no se pudo enviar el pedido de ubicación");
    }

    return reply.code(200).send({ definido: true, tipo: "DELIVERY", ubicacionSolicitada: true });
  });

  app.post("/orden/cerrar", async (req, reply) => {
    const call = authenticateToolCall(req, reply, app.env);
    if (!call) return;

    const query = buscarProductosQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: "merchantId_faltante" });
    }

    const merchant = await prisma.merchant.findUnique({ where: { id: query.data.merchantId } });
    if (!merchant || !merchant.zavuSenderId) {
      return reply.code(200).send({ error: "comercio_no_encontrado" });
    }

    if (!merchant.vesRate || !merchant.payoutInstructions) {
      return reply.code(200).send({ error: "comercio_no_configurado" });
    }

    const order = await prisma.order.findFirst({
      where: { merchantId: query.data.merchantId, buyerPhone: call.context.contactPhone, status: "BORRADOR" },
      include: { items: true },
    });

    if (!order || order.items.length === 0) {
      return reply.code(200).send({ error: "carrito_vacio" });
    }

    if (!order.fulfillment) {
      return reply.code(200).send({ error: "falta_definir_entrega" });
    }

    if (order.fulfillment === "DELIVERY" && order.deliveryLat === null) {
      return reply.code(200).send({ error: "falta_ubicacion" });
    }

    const cart = await buildCartSnapshot(order.id, query.data.merchantId);
    const totalVes = cart.totalVes ?? 0;

    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "ESPERANDO_PAGO",
        totalUsd: cart.totalUsd,
        totalVes,
        vesRateUsed: merchant.vesRate,
      },
    });

    const zavu = getZavuClient(app.env.ZAVU_API_KEY);
    try {
      await zavu.messages.send(
        {
          to: call.context.contactPhone,
          text: `Total: $${cart.totalUsd.toFixed(2)} (Bs. ${totalVes.toFixed(2)})\n\nPara pagar:\n${merchant.payoutInstructions}\n\nCuando pagues, mandame la foto del comprobante acá mismo.`,
        },
        withSender(merchant.zavuSenderId),
      );
    } catch (err) {
      req.log.error({ err, orderId: order.id }, "no se pudo enviar los datos de cobro");
    }

    return reply.code(200).send({
      cerrada: true,
      totalUsd: cart.totalUsd,
      totalVes,
      vesRateUsed: Number(merchant.vesRate),
    });
  });
}
