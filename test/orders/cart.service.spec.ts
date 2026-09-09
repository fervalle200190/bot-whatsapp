import { beforeEach, describe, expect, it } from 'bun:test';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CartService } from '../../src/orders/cart.service';
import { Order, OrderStatus } from '../../src/orders/order.entity';
import { OrderItem } from '../../src/orders/order-item.entity';
import { Merchant } from '../../src/merchants/merchant.entity';
import { Product } from '../../src/catalog/product.entity';
import { createFakeRepo, type FakeRepo } from '../fakes/fake-repo';

describe('CartService', () => {
  let service: CartService;
  let ordersRepo: FakeRepo<Order>;
  let itemsRepo: FakeRepo<OrderItem>;
  let merchantsRepo: FakeRepo<Merchant>;

  beforeEach(async () => {
    ordersRepo = createFakeRepo<Order>();
    itemsRepo = createFakeRepo<OrderItem>();
    merchantsRepo = createFakeRepo<Merchant>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: getRepositoryToken(OrderItem), useValue: itemsRepo },
        { provide: getRepositoryToken(Merchant), useValue: merchantsRepo },
      ],
    }).compile();

    service = moduleRef.get(CartService);
  });

  it('crea un borrador nuevo si no existe y reutiliza el mismo en la segunda llamada', async () => {
    const first = await service.getOrCreateDraft('m1', '+58911');
    const second = await service.getOrCreateDraft('m1', '+58911');

    expect(first.id).toBe(second.id);
    expect(first.status).toBe(OrderStatus.BORRADOR);
    expect(ordersRepo.rows).toHaveLength(1);
  });

  it('fusiona la cantidad en un solo OrderItem si el producto ya estaba en el carrito', async () => {
    const product = { id: 'p1', name: 'Arepa', priceUsd: 3.5 } as Product;

    const order = await service.add('m1', '+58911', product, 2);
    await service.add('m1', '+58911', product, 3);

    const snapshot = await service.snapshot(order.id, 'm1');
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]!.cantidad).toBe(5);
    expect(snapshot.totalUsd).toBe(17.5);
  });

  it('calcula totalVes = totalUsd × vesRate redondeado, o null si el comercio no tiene tasa', async () => {
    await merchantsRepo.save({ id: 'm1', vesRate: null } as Merchant);
    const product = { id: 'p1', name: 'Jugo', priceUsd: 1.5 } as Product;

    const order = await service.add('m1', '+58911', product, 2);
    let snapshot = await service.snapshot(order.id, 'm1');
    expect(snapshot.totalUsd).toBe(3);
    expect(snapshot.totalVes).toBeNull();

    await merchantsRepo.update({ id: 'm1' }, { vesRate: 100 });
    snapshot = await service.snapshot(order.id, 'm1');
    expect(snapshot.totalVes).toBe(300);
  });

  it('emptySnapshot: items vacíos y totalVes 0 si hay tasa, null si no', async () => {
    const sinTasa = await service.emptySnapshot('sin-tasa');
    expect(sinTasa).toEqual({ items: [], totalUsd: 0, totalVes: null });

    await merchantsRepo.save({ id: 'con-tasa', vesRate: 50 } as Merchant);
    const conTasa = await service.emptySnapshot('con-tasa');
    expect(conTasa).toEqual({ items: [], totalUsd: 0, totalVes: 0 });
  });
});
