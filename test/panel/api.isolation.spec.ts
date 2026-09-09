import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Merchant, MerchantStatus } from '../../src/merchants/merchant.entity';
import { Order, OrderStatus, Fulfillment } from '../../src/orders/order.entity';
import { OrderItem } from '../../src/orders/order-item.entity';
import { PaymentProof, ProofDecision } from '../../src/orders/payment-proof.entity';

/**
 * Test de integración real (paso 9 del plan de SPEC 04): dos comercios,
 * dos tokens, contra Postgres real. Ninguna ruta del panel debe cruzar
 * datos entre comercios.
 */

const TOKEN_A = 'panel_token_isolation_a';
const TOKEN_B = 'panel_token_isolation_b';

let app: INestApplication;
let merchantsRepo: Repository<Merchant>;
let ordersRepo: Repository<Order>;
let orderItemsRepo: Repository<OrderItem>;
let paymentProofsRepo: Repository<PaymentProof>;
let merchantAId: string;
let merchantBId: string;
let orderAId: string;
let orderBId: string;
const originalFetch = globalThis.fetch;

function api(token?: string) {
  const req = request(app.getHttpServer());
  return {
    get: (path: string) => (token ? req.get(path).set('Authorization', `Bearer ${token}`) : req.get(path)),
    post: (path: string) => (token ? req.post(path).set('Authorization', `Bearer ${token}`) : req.post(path)),
    put: (path: string) => (token ? req.put(path).set('Authorization', `Bearer ${token}`) : req.put(path)),
  };
}

beforeAll(async () => {
  globalThis.fetch = (async (url: string | URL) => {
    const urlStr = String(url);
    if (urlStr === 'https://graph.facebook.com/v21.0/MEDIA_ISOLATION_A') {
      return { ok: true, json: async () => ({ url: 'https://cdn.test/a.jpg' }) } as Response;
    }
    if (urlStr === 'https://cdn.test/a.jpg') {
      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('contenido-a').buffer,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      } as Response;
    }
    return { ok: true } as Response; // sendText/sendLocationRequest de MetaMessagingService
  }) as unknown as typeof fetch;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  merchantsRepo = moduleRef.get(getRepositoryToken(Merchant));
  ordersRepo = moduleRef.get(getRepositoryToken(Order));
  orderItemsRepo = moduleRef.get(getRepositoryToken(OrderItem));
  paymentProofsRepo = moduleRef.get(getRepositoryToken(PaymentProof));

  const merchantA = await merchantsRepo.save(
    merchantsRepo.create({
      name: 'Panel Aislamiento A',
      ownerPhone: '+58900000101',
      status: MerchantStatus.ACTIVO,
      vesRate: 100,
      payoutInstructions: 'Datos de cobro A',
      metaPhoneNumberId: 'PN_PANEL_A',
      panelToken: TOKEN_A,
    }),
  );
  const merchantB = await merchantsRepo.save(
    merchantsRepo.create({
      name: 'Panel Aislamiento B',
      ownerPhone: '+58900000102',
      status: MerchantStatus.ACTIVO,
      vesRate: 200,
      payoutInstructions: 'Datos de cobro B',
      metaPhoneNumberId: 'PN_PANEL_B',
      panelToken: TOKEN_B,
    }),
  );
  merchantAId = merchantA.id;
  merchantBId = merchantB.id;

  const orderA = await ordersRepo.save(
    ordersRepo.create({
      merchantId: merchantAId,
      buyerPhone: '+58900000199',
      status: OrderStatus.PAGO_EN_REVISION,
      fulfillment: Fulfillment.RETIRO,
      totalUsd: 10,
      totalVes: 1000,
      vesRateUsed: 100,
    }),
  );
  const orderB = await ordersRepo.save(
    ordersRepo.create({
      merchantId: merchantBId,
      buyerPhone: '+58900000299',
      status: OrderStatus.PAGO_EN_REVISION,
      fulfillment: Fulfillment.RETIRO,
      totalUsd: 20,
      totalVes: 4000,
      vesRateUsed: 200,
    }),
  );
  orderAId = orderA.id;
  orderBId = orderB.id;

  await orderItemsRepo.save([
    orderItemsRepo.create({ orderId: orderAId, productId: 'p1', nameSnapshot: 'Producto A', unitPriceUsd: 10, qty: 1 }),
    orderItemsRepo.create({ orderId: orderBId, productId: 'p2', nameSnapshot: 'Producto B', unitPriceUsd: 20, qty: 1 }),
  ]);

  await paymentProofsRepo.save([
    paymentProofsRepo.create({
      orderId: orderAId,
      mediaId: 'MEDIA_ISOLATION_A',
      sourceMessageId: 'wamid.A',
      decision: ProofDecision.PENDIENTE,
    }),
    paymentProofsRepo.create({
      orderId: orderBId,
      mediaId: 'MEDIA_ISOLATION_B',
      sourceMessageId: 'wamid.B',
      decision: ProofDecision.PENDIENTE,
    }),
  ]);
});

afterAll(async () => {
  const merchantIds = [merchantAId, merchantBId];
  const orderIds = [orderAId, orderBId];
  await paymentProofsRepo.delete({ orderId: In(orderIds) });
  await orderItemsRepo.delete({ orderId: In(orderIds) });
  await ordersRepo.delete({ id: In(orderIds) });
  await merchantsRepo.delete({ id: In(merchantIds) });
  await app.close();
  globalThis.fetch = originalFetch;
});

describe('aislamiento del panel del comercio', () => {
  it('toda ruta /api/* sin Authorization o con token inexistente devuelve 401', async () => {
    expect((await api().get('/api/me')).status).toBe(401);
    expect((await api('token-inventado').get('/api/me')).status).toBe(401);
  });

  it('GET /api/me devuelve los datos del comercio del token', async () => {
    const res = await api(TOKEN_A).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(merchantAId);
    expect(res.body.name).toBe('Panel Aislamiento A');
  });

  it('GET /api/ordenes de A nunca incluye pedidos de B', async () => {
    const res = await api(TOKEN_A).get('/api/ordenes');
    expect(res.status).toBe(200);
    const ids = (res.body.ordenes as { id: string }[]).map((o) => o.id);
    expect(ids).toContain(orderAId);
    expect(ids).not.toContain(orderBId);
  });

  it('GET /api/ordenes/:id/comprobante de un pedido ajeno devuelve 404', async () => {
    const res = await api(TOKEN_A).get(`/api/ordenes/${orderBId}/comprobante`);
    expect(res.status).toBe(404);
  });

  it('GET /api/ordenes/:id/comprobante de un pedido propio devuelve la imagen', async () => {
    const res = await api(TOKEN_A).get(`/api/ordenes/${orderAId}/comprobante`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
  });

  it('aceptar un pedido con el token de otro comercio devuelve 404 sin cambios', async () => {
    const res = await api(TOKEN_A).post(`/api/ordenes/${orderBId}/aceptar`);
    expect(res.status).toBe(404);

    const orderB = await ordersRepo.findOneOrFail({ where: { id: orderBId } });
    expect(orderB.status).toBe(OrderStatus.PAGO_EN_REVISION);
  });

  it('PUT /api/tasa con el token de A solo actualiza la tasa de A', async () => {
    const res = await api(TOKEN_A).put('/api/tasa').send({ tasaBsPorUsd: 555 });
    expect(res.status).toBe(200);
    expect(res.body.vesRate).toBe(555);

    const merchantA = await merchantsRepo.findOneOrFail({ where: { id: merchantAId } });
    const merchantB = await merchantsRepo.findOneOrFail({ where: { id: merchantBId } });
    expect(Number(merchantA.vesRate)).toBe(555);
    expect(Number(merchantB.vesRate)).toBe(200);
  });

  it('PUT /api/tasa inválida (no positiva) devuelve 400', async () => {
    const res = await api(TOKEN_A).put('/api/tasa').send({ tasaBsPorUsd: -1 });
    expect(res.status).toBe(400);
  });

  it('aceptar el pedido propio deja APROBADA y avisa al comprador; B no se toca', async () => {
    const res = await api(TOKEN_A).post(`/api/ordenes/${orderAId}/aceptar`);
    expect(res.status).toBe(201);
    expect(res.body.orden.status).toBe('APROBADA');
    expect(res.body.orden.comprobante.decision).toBe('APROBADO');

    const orderB = await ordersRepo.findOneOrFail({ where: { id: orderBId } });
    expect(orderB.status).toBe(OrderStatus.PAGO_EN_REVISION);
  });

  it('aceptar de nuevo (ya no está en PAGO_EN_REVISION) devuelve 409', async () => {
    const res = await api(TOKEN_A).post(`/api/ordenes/${orderAId}/aceptar`);
    expect(res.status).toBe(409);
  });

  it('PUT /api/cobro vacío devuelve 400; válido actualiza solo el comercio del token', async () => {
    const invalido = await api(TOKEN_A).put('/api/cobro').send({ datosCobro: '' });
    expect(invalido.status).toBe(400);

    const valido = await api(TOKEN_A).put('/api/cobro').send({ datosCobro: 'Nuevos datos de cobro A' });
    expect(valido.status).toBe(200);
    expect(valido.body.payoutInstructions).toBe('Nuevos datos de cobro A');

    const merchantB = await merchantsRepo.findOneOrFail({ where: { id: merchantBId } });
    expect(merchantB.payoutInstructions).toBe('Datos de cobro B');
  });

  it('regenerar el token: el viejo deja de servir y el nuevo funciona', async () => {
    const res = await api(TOKEN_A).post('/api/token/regenerar');
    expect(res.status).toBe(201);
    const newToken = res.body.panelToken as string;
    expect(newToken).not.toBe(TOKEN_A);

    const withOldToken = await api(TOKEN_A).get('/api/me');
    expect(withOldToken.status).toBe(401);

    const withNewToken = await api(newToken).get('/api/me');
    expect(withNewToken.status).toBe(200);
    expect(withNewToken.body.id).toBe(merchantAId);
  });
});
