import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Merchant, MerchantStatus } from '../../src/merchants/merchant.entity';
import { Product, ProductSource } from '../../src/catalog/product.entity';
import { Fulfillment, Order } from '../../src/orders/order.entity';
import { OrderItem } from '../../src/orders/order-item.entity';

/**
 * Test de integración real (paso 10 del plan): dos comercios con catálogos
 * y carritos cruzados, contra el server real y Postgres real — sin mocks.
 * Falla si cualquier tool devuelve o modifica algo de otro merchantId.
 */

const TOOLS_SECRET = process.env.TOOLS_SHARED_SECRET as string;
const OWNER_A = '+58900000001';
const OWNER_B = '+58900000002';
const BUYER = '+58900000099';

let app: INestApplication;
let merchantsRepo: Repository<Merchant>;
let productsRepo: Repository<Product>;
let ordersRepo: Repository<Order>;
let orderItemsRepo: Repository<OrderItem>;
let merchantAId: string;
let merchantBId: string;
const originalFetch = globalThis.fetch;

function callTool(path: string, body: { merchantId: string; contactPhone: string; arguments: Record<string, unknown> }) {
  return request(app.getHttpServer()).post(path).set('X-Tools-Secret', TOOLS_SECRET).send(body);
}

beforeAll(async () => {
  if (!TOOLS_SECRET) throw new Error('TOOLS_SHARED_SECRET no está definido; revisá el .env de test.');

  // Este test ejercita `MetaMessagingService` real (vía `cerrar_orden` /
  // `definir_entrega`); se mockea `fetch` para no llamar a Meta de verdad.
  globalThis.fetch = (async () => ({ ok: true }) as Response) as unknown as typeof fetch;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  merchantsRepo = moduleRef.get(getRepositoryToken(Merchant));
  productsRepo = moduleRef.get(getRepositoryToken(Product));
  ordersRepo = moduleRef.get(getRepositoryToken(Order));
  orderItemsRepo = moduleRef.get(getRepositoryToken(OrderItem));

  const merchantA = await merchantsRepo.save(
    merchantsRepo.create({
      name: 'Comercio Aislamiento A',
      ownerPhone: OWNER_A,
      status: MerchantStatus.ACTIVO,
      vesRate: 100,
      payoutInstructions: 'Datos de cobro A',
      metaPhoneNumberId: 'PN_ISOLATION_A',
    }),
  );
  const merchantB = await merchantsRepo.save(
    merchantsRepo.create({
      name: 'Comercio Aislamiento B',
      ownerPhone: OWNER_B,
      status: MerchantStatus.ACTIVO,
      vesRate: 200,
      payoutInstructions: 'Datos de cobro B',
      metaPhoneNumberId: 'PN_ISOLATION_B',
    }),
  );
  merchantAId = merchantA.id;
  merchantBId = merchantB.id;

  await productsRepo.save([
    productsRepo.create({
      merchantId: merchantAId,
      name: 'Producto Secreto A',
      description: null,
      priceUsd: 10,
      available: true,
      source: ProductSource.MANUAL_CHAT,
    }),
    productsRepo.create({
      merchantId: merchantBId,
      name: 'Producto Secreto B',
      description: null,
      priceUsd: 20,
      available: true,
      source: ProductSource.MANUAL_CHAT,
    }),
  ]);
});

afterAll(async () => {
  const merchantIds = [merchantAId, merchantBId];
  const orders = await ordersRepo.find({ where: { merchantId: In(merchantIds) } });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length > 0) {
    await orderItemsRepo.delete({ orderId: In(orderIds) });
    await ordersRepo.delete({ id: In(orderIds) });
  }
  await productsRepo.delete({ merchantId: In(merchantIds) });
  await merchantsRepo.delete({ id: In(merchantIds) });
  await app.close();
  globalThis.fetch = originalFetch;
});

describe('aislamiento multi-tenant entre comercios', () => {
  it('buscar_productos de A nunca devuelve productos de B', async () => {
    const res = await callTool('/tools/catalogo/buscar', { merchantId: merchantAId, contactPhone: BUYER, arguments: {} });
    const nombres = (res.body.productos as { nombre: string }[]).map((p) => p.nombre);
    expect(nombres).toContain('Producto Secreto A');
    expect(nombres).not.toContain('Producto Secreto B');
  });

  it("buscar 'secreto' desde A no encuentra el producto de B aunque el término matchee", async () => {
    const res = await callTool('/tools/catalogo/buscar', {
      merchantId: merchantAId,
      contactPhone: BUYER,
      arguments: { termino: 'secreto' },
    });
    const nombres = (res.body.productos as { nombre: string }[]).map((p) => p.nombre);
    expect(nombres).toEqual(['Producto Secreto A']);
  });

  it('agregar_al_carrito de A no puede agregar un producto que solo existe en B', async () => {
    const res = await callTool('/tools/carrito/agregar', {
      merchantId: merchantAId,
      contactPhone: BUYER,
      arguments: { nombreProducto: 'Producto Secreto B' },
    });
    expect(res.body).toEqual({ error: 'producto_no_encontrado' });
  });

  it('el mismo comprador tiene carritos completamente separados por comercio', async () => {
    await callTool('/tools/carrito/agregar', {
      merchantId: merchantAId,
      contactPhone: BUYER,
      arguments: { nombreProducto: 'Producto Secreto A' },
    });
    await callTool('/tools/carrito/agregar', {
      merchantId: merchantBId,
      contactPhone: BUYER,
      arguments: { nombreProducto: 'Producto Secreto B', cantidad: 3 },
    });

    const cartA = await callTool('/tools/carrito/ver', { merchantId: merchantAId, contactPhone: BUYER, arguments: {} });
    const cartB = await callTool('/tools/carrito/ver', { merchantId: merchantBId, contactPhone: BUYER, arguments: {} });

    expect((cartA.body.carrito.items as { nombre: string }[]).map((i) => i.nombre)).toEqual(['Producto Secreto A']);
    expect((cartB.body.carrito.items as { nombre: string }[]).map((i) => i.nombre)).toEqual(['Producto Secreto B']);
  });

  it('cerrar_orden de A usa la tasa de A, nunca la de B', async () => {
    await callTool('/tools/orden/entrega', { merchantId: merchantAId, contactPhone: BUYER, arguments: { tipo: 'retiro' } });
    const res = await callTool('/tools/orden/cerrar', { merchantId: merchantAId, contactPhone: BUYER, arguments: {} });

    expect(res.body.cerrada).toBe(true);
    expect(res.body.vesRateUsed).toBe(100);
  });

  it('definir_entrega de A no toca órdenes de B', async () => {
    await callTool('/tools/orden/entrega', { merchantId: merchantBId, contactPhone: BUYER, arguments: { tipo: 'retiro' } });
    const orderB = await ordersRepo.findOne({ where: { merchantId: merchantBId, buyerPhone: BUYER } });
    expect(orderB?.fulfillment).toBe(Fulfillment.RETIRO);

    await callTool('/tools/orden/entrega', { merchantId: merchantAId, contactPhone: BUYER, arguments: { tipo: 'delivery' } });

    const orderBAfter = await ordersRepo.findOne({ where: { id: orderB!.id } });
    expect(orderBAfter?.fulfillment).toBe(Fulfillment.RETIRO);
  });
});
