import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import type { Env } from "../../env.js";

/**
 * Test de integración real (paso 20): dos comercios con catálogos y
 * carritos cruzados, contra el server real y Postgres real — sin mocks.
 * Falla si cualquier tool devuelve o modifica algo de otro merchantId.
 */

const TOOLS_SECRET = "test_isolation_secret";
const OPERATOR_SENDER_ID = "test_isolation_operator";

const testEnv: Env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  PORT: 3000,
  PUBLIC_BASE_URL: "http://localhost:3000",
  ZAVU_API_KEY: "irrelevante_para_este_test",
  ZAVU_OPERATOR_SENDER_ID: OPERATOR_SENDER_ID,
  ZAVU_OPERATOR_WEBHOOK_SECRET: "irrelevante",
  ZAVU_TOOLS_WEBHOOK_SECRET: TOOLS_SECRET,
  ZAVU_PAGO_EN_REVISION_TEMPLATE_ID: "irrelevante",
  ANTHROPIC_API_KEY: "irrelevante",
};

function signToolCall(rawBody: string): string {
  const t = Math.floor(Date.now() / 1000);
  const hmac = createHmac("sha256", TOOLS_SECRET).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v2=${hmac}`;
}

async function callTool(
  app: FastifyInstance,
  path: string,
  tool: string,
  args: Record<string, unknown>,
  contactPhone: string,
) {
  const payload = {
    tool,
    arguments: args,
    context: { messageId: "m", contactPhone, sessionId: "s" },
    timestamp: Date.now(),
  };
  const rawBody = JSON.stringify(payload);
  const res = await app.inject({
    method: "POST",
    url: path,
    payload: rawBody,
    headers: { "content-type": "application/json", "x-zavu-signature": signToolCall(rawBody) },
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

const OWNER_A = "+58900000001";
const OWNER_B = "+58900000002";
const BUYER = "+58900000099";

let app: FastifyInstance;
let merchantAId: string;
let merchantBId: string;

beforeAll(async () => {
  app = await buildApp(testEnv);
  await app.ready();

  const merchantA = await prisma.merchant.create({
    data: {
      name: "Comercio Aislamiento A",
      ownerPhone: OWNER_A,
      status: "ACTIVO",
      zavuSenderId: "sender_isolation_a",
      zavuSenderWebhookSecret: "irrelevante_a",
      vesRate: 100,
      payoutInstructions: "Datos de cobro A",
    },
  });
  const merchantB = await prisma.merchant.create({
    data: {
      name: "Comercio Aislamiento B",
      ownerPhone: OWNER_B,
      status: "ACTIVO",
      zavuSenderId: "sender_isolation_b",
      zavuSenderWebhookSecret: "irrelevante_b",
      vesRate: 200,
      payoutInstructions: "Datos de cobro B",
    },
  });
  merchantAId = merchantA.id;
  merchantBId = merchantB.id;

  await prisma.product.createMany({
    data: [
      { merchantId: merchantAId, name: "Producto Secreto A", description: null, priceUsd: 10, available: true, source: "MANUAL_CHAT" },
      { merchantId: merchantBId, name: "Producto Secreto B", description: null, priceUsd: 20, available: true, source: "MANUAL_CHAT" },
    ],
  });

  await prisma.menuImport.create({
    data: {
      merchantId: merchantBId,
      sourceUrl: "https://x.test/menu-b.jpg",
      status: "ESPERANDO_CONFIRMACION",
      extracted: [{ name: "Borrador Secreto B", description: null, priceUsd: 99 }],
      model: "claude-opus-5",
    },
  });
});

afterAll(async () => {
  const merchantIds = [merchantAId, merchantBId];
  const orders = await prisma.order.findMany({ where: { merchantId: { in: merchantIds } } });
  const orderIds = orders.map((o) => o.id);
  await prisma.paymentProof.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await prisma.product.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await prisma.menuImport.deleteMany({ where: { merchantId: { in: merchantIds } } });
  await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
  await app.close();
  await prisma.$disconnect();
});

describe("aislamiento multi-tenant entre comercios (paso 20)", () => {
  it("buscar_productos de A nunca devuelve productos de B", async () => {
    const { body } = await callTool(app, `/tools/catalogo/buscar?merchantId=${merchantAId}`, "buscar_productos", {}, BUYER);
    const nombres = (body.productos as { nombre: string }[]).map((p) => p.nombre);
    expect(nombres).toContain("Producto Secreto A");
    expect(nombres).not.toContain("Producto Secreto B");
  });

  it("buscar 'secreto' desde A no encuentra el producto de B aunque el término matchee", async () => {
    const { body } = await callTool(
      app,
      `/tools/catalogo/buscar?merchantId=${merchantAId}`,
      "buscar_productos",
      { termino: "secreto" },
      BUYER,
    );
    const nombres = (body.productos as { nombre: string }[]).map((p) => p.nombre);
    expect(nombres).toEqual(["Producto Secreto A"]);
  });

  it("agregar_al_carrito de A no puede agregar un producto que solo existe en B", async () => {
    const { body } = await callTool(
      app,
      `/tools/carrito/agregar?merchantId=${merchantAId}`,
      "agregar_al_carrito",
      { nombreProducto: "Producto Secreto B" },
      BUYER,
    );
    expect(body).toEqual({ error: "producto_no_encontrado" });
  });

  it("el mismo comprador tiene carritos completamente separados por comercio", async () => {
    await callTool(app, `/tools/carrito/agregar?merchantId=${merchantAId}`, "agregar_al_carrito", { nombreProducto: "Producto Secreto A" }, BUYER);
    await callTool(app, `/tools/carrito/agregar?merchantId=${merchantBId}`, "agregar_al_carrito", { nombreProducto: "Producto Secreto B", cantidad: 3 }, BUYER);

    const { body: cartA } = await callTool(app, `/tools/carrito/ver?merchantId=${merchantAId}`, "ver_carrito", {}, BUYER);
    const { body: cartB } = await callTool(app, `/tools/carrito/ver?merchantId=${merchantBId}`, "ver_carrito", {}, BUYER);

    const itemsA = (cartA.carrito as { items: { nombre: string }[] }).items;
    const itemsB = (cartB.carrito as { items: { nombre: string }[] }).items;

    expect(itemsA.map((i) => i.nombre)).toEqual(["Producto Secreto A"]);
    expect(itemsB.map((i) => i.nombre)).toEqual(["Producto Secreto B"]);
  });

  it("editar_producto con el ownerPhone del comercio A no puede tocar el borrador pendiente del comercio B", async () => {
    const { body } = await callTool(
      app,
      "/tools/producto/editar",
      "editar_producto",
      { nombreActual: "Borrador Secreto B", nuevoPrecioUsd: 1 },
      OWNER_A,
    );
    expect(body).toEqual({ error: "no_hay_menu_pendiente" });

    const stillPending = await prisma.menuImport.findFirst({ where: { merchantId: merchantBId } });
    const items = stillPending!.extracted as { priceUsd: number }[];
    expect(items[0]!.priceUsd).toBe(99);
  });

  it("actualizar_tasa con el ownerPhone de A nunca modifica la tasa de B", async () => {
    await callTool(app, "/tools/tasa/actualizar", "actualizar_tasa", { tasaBsPorUsd: 555 }, OWNER_A);

    const merchantA = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantAId } });
    const merchantB = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantBId } });

    expect(Number(merchantA.vesRate)).toBe(555);
    expect(Number(merchantB.vesRate)).toBe(200);
  });
});
