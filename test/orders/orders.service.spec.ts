import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrdersService } from '../../src/orders/orders.service';
import { CartService } from '../../src/orders/cart.service';
import { MessagingPort } from '../../src/messaging/messaging.port';
import { Fulfillment, Order, OrderStatus } from '../../src/orders/order.entity';
import { Merchant } from '../../src/merchants/merchant.entity';
import { PaymentProof } from '../../src/orders/payment-proof.entity';
import { createFakeRepo, type FakeRepo } from '../fakes/fake-repo';

describe('OrdersService', () => {
  let service: OrdersService;
  let ordersRepo: FakeRepo<Order>;
  let merchantsRepo: FakeRepo<Merchant>;
  let paymentProofsRepo: FakeRepo<PaymentProof>;
  let cart: { getOrCreateDraft: ReturnType<typeof mock>; findDraft: ReturnType<typeof mock>; snapshot: ReturnType<typeof mock> };
  let messaging: { sendText: ReturnType<typeof mock>; sendLocationRequest: ReturnType<typeof mock> };

  beforeEach(async () => {
    ordersRepo = createFakeRepo<Order>();
    merchantsRepo = createFakeRepo<Merchant>();
    paymentProofsRepo = createFakeRepo<PaymentProof>();

    messaging = {
      sendText: mock(async () => {}),
      sendLocationRequest: mock(async () => {}),
    };

    cart = {
      getOrCreateDraft: mock(async (merchantId: string, buyerPhone: string) => {
        const existing = ordersRepo.rows.find(
          (o) => o.merchantId === merchantId && o.buyerPhone === buyerPhone && o.status === OrderStatus.BORRADOR,
        );
        if (existing) return existing;
        return ordersRepo.save({
          merchantId,
          buyerPhone,
          status: OrderStatus.BORRADOR,
          fulfillment: null,
          deliveryLat: null,
          deliveryLng: null,
        } as Partial<Order>);
      }),
      findDraft: mock(async (merchantId: string, buyerPhone: string) =>
        ordersRepo.rows.find(
          (o) => o.merchantId === merchantId && o.buyerPhone === buyerPhone && o.status === OrderStatus.BORRADOR,
        ) ?? null,
      ),
      snapshot: mock(async () => ({
        items: [{ nombre: 'Arepa', cantidad: 1, precioUnitarioUsd: 3.5 }],
        totalUsd: 3.5,
        totalVes: 1260,
      })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: getRepositoryToken(Merchant), useValue: merchantsRepo },
        { provide: getRepositoryToken(PaymentProof), useValue: paymentProofsRepo },
        { provide: CartService, useValue: cart },
        { provide: MessagingPort, useValue: messaging },
      ],
    }).compile();

    service = moduleRef.get(OrdersService);
  });

  it('definir_entrega con comercio inexistente devuelve comercio_no_configurado', async () => {
    const result = await service.definirEntrega('no-existe', '+58911', Fulfillment.RETIRO);
    expect(result).toEqual({ error: 'comercio_no_configurado' });
  });

  it('definir_entrega RETIRO no pide ubicación', async () => {
    await merchantsRepo.save({ id: 'm1' } as Merchant);
    const result = await service.definirEntrega('m1', '+58911', Fulfillment.RETIRO);

    expect(result).toEqual({ definido: true, tipo: 'RETIRO' });
    expect(messaging.sendLocationRequest).not.toHaveBeenCalled();
  });

  it('definir_entrega DELIVERY pide ubicación exactamente una vez', async () => {
    await merchantsRepo.save({ id: 'm1' } as Merchant);
    const result = await service.definirEntrega('m1', '+58911', Fulfillment.DELIVERY);

    expect(result).toEqual({ definido: true, tipo: 'DELIVERY', ubicacionSolicitada: true });
    expect(messaging.sendLocationRequest).toHaveBeenCalledTimes(1);
  });

  it('cerrar_orden: carrito_vacio si no hay items', async () => {
    await merchantsRepo.save({ id: 'm1', vesRate: 100, payoutInstructions: 'datos' } as Merchant);
    await ordersRepo.save({
      merchantId: 'm1',
      buyerPhone: '+58911',
      status: OrderStatus.BORRADOR,
      items: [],
    } as unknown as Partial<Order>);

    const result = await service.cerrar('m1', '+58911');
    expect(result).toEqual({ error: 'carrito_vacio' });
  });

  it('cerrar_orden: falta_definir_entrega si no hay fulfillment', async () => {
    await merchantsRepo.save({ id: 'm1', vesRate: 100, payoutInstructions: 'datos' } as Merchant);
    await ordersRepo.save({
      merchantId: 'm1',
      buyerPhone: '+58911',
      status: OrderStatus.BORRADOR,
      items: [{ id: 'i1' }],
    } as unknown as Partial<Order>);

    const result = await service.cerrar('m1', '+58911');
    expect(result).toEqual({ error: 'falta_definir_entrega' });
  });

  it('cerrar_orden: falta_ubicacion si es DELIVERY sin coordenadas', async () => {
    await merchantsRepo.save({ id: 'm1', vesRate: 100, payoutInstructions: 'datos' } as Merchant);
    await ordersRepo.save({
      merchantId: 'm1',
      buyerPhone: '+58911',
      status: OrderStatus.BORRADOR,
      items: [{ id: 'i1' }],
      fulfillment: Fulfillment.DELIVERY,
      deliveryLat: null,
    } as unknown as Partial<Order>);

    const result = await service.cerrar('m1', '+58911');
    expect(result).toEqual({ error: 'falta_ubicacion' });
  });

  it('cerrar_orden: comercio_no_configurado si falta tasa o datos de cobro', async () => {
    await merchantsRepo.save({ id: 'm1', vesRate: null, payoutInstructions: null } as Merchant);
    const result = await service.cerrar('m1', '+58911');
    expect(result).toEqual({ error: 'comercio_no_configurado' });
  });

  it('cerrar_orden: camino feliz congela los montos, pasa a ESPERANDO_PAGO y avisa al comprador', async () => {
    await merchantsRepo.save({ id: 'm1', vesRate: 360, payoutInstructions: 'Pago móvil' } as Merchant);
    const order = await ordersRepo.save({
      merchantId: 'm1',
      buyerPhone: '+58911',
      status: OrderStatus.BORRADOR,
      items: [{ id: 'i1' }],
      fulfillment: Fulfillment.RETIRO,
      deliveryLat: null,
    } as unknown as Partial<Order>);

    const result = await service.cerrar('m1', '+58911');

    expect(result).toEqual({ cerrada: true, totalUsd: 3.5, totalVes: 1260, vesRateUsed: 360 });

    const updated = ordersRepo.rows.find((o) => o.id === order.id)!;
    expect(updated.status).toBe(OrderStatus.ESPERANDO_PAGO);
    expect(updated.totalUsd).toBe(3.5);
    expect(updated.totalVes).toBe(1260);
    expect(updated.vesRateUsed).toBe(360);
    expect(messaging.sendText).toHaveBeenCalledTimes(1);
  });

  it('cambiar vesRate después de cerrar no modifica totalVes ni vesRateUsed de la orden cerrada', async () => {
    await merchantsRepo.save({ id: 'm1', vesRate: 360, payoutInstructions: 'Pago móvil' } as Merchant);
    const order = await ordersRepo.save({
      merchantId: 'm1',
      buyerPhone: '+58911',
      status: OrderStatus.BORRADOR,
      items: [{ id: 'i1' }],
      fulfillment: Fulfillment.RETIRO,
      deliveryLat: null,
    } as unknown as Partial<Order>);

    await service.cerrar('m1', '+58911');
    await merchantsRepo.update({ id: 'm1' }, { vesRate: 999 });

    const closedOrder = ordersRepo.rows.find((o) => o.id === order.id)!;
    expect(closedOrder.totalVes).toBe(1260);
    expect(closedOrder.vesRateUsed).toBe(360);
  });
});
