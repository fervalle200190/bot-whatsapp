import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Merchant } from '../merchants/merchant.entity';
import { Product } from '../catalog/product.entity';
import { Order, OrderStatus } from './order.entity';
import { OrderItem } from './order-item.entity';

export interface CartSnapshot {
  items: { nombre: string; cantidad: number; precioUnitarioUsd: number }[];
  totalUsd: number;
  totalVes: number | null;
}

/** Un carrito ES una Order en BORRADOR. A lo sumo una por (merchantId, buyerPhone). */
@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly orderItems: Repository<OrderItem>,
    @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
  ) {}

  async getOrCreateDraft(merchantId: string, buyerPhone: string): Promise<Order> {
    const existing = await this.findDraft(merchantId, buyerPhone);
    if (existing) return existing;

    const order = this.orders.create({ merchantId, buyerPhone, status: OrderStatus.BORRADOR });
    return this.orders.save(order);
  }

  async findDraft(merchantId: string, buyerPhone: string): Promise<Order | null> {
    return this.orders.findOne({ where: { merchantId, buyerPhone, status: OrderStatus.BORRADOR } });
  }

  /** Estado vacío de `ver_carrito` cuando el comprador todavía no tiene ninguna Order en BORRADOR. */
  async emptySnapshot(merchantId: string): Promise<CartSnapshot> {
    const merchant = await this.merchants.findOne({ where: { id: merchantId } });
    return { items: [], totalUsd: 0, totalVes: merchant?.vesRate ? 0 : null };
  }

  /** Agrega el producto al carrito, fusionando la cantidad si ya estaba. */
  async add(merchantId: string, buyerPhone: string, product: Product, cantidad: number): Promise<Order> {
    const order = await this.getOrCreateDraft(merchantId, buyerPhone);

    const existingItem = await this.orderItems.findOne({
      where: { orderId: order.id, productId: product.id },
    });

    if (existingItem) {
      await this.orderItems.update({ id: existingItem.id }, { qty: existingItem.qty + cantidad });
    } else {
      const item = this.orderItems.create({
        orderId: order.id,
        productId: product.id,
        nameSnapshot: product.name,
        unitPriceUsd: product.priceUsd,
        qty: cantidad,
      });
      await this.orderItems.save(item);
    }

    return order;
  }

  async snapshot(orderId: string, merchantId: string): Promise<CartSnapshot> {
    const [items, merchant] = await Promise.all([
      this.orderItems.find({ where: { orderId } }),
      this.merchants.findOne({ where: { id: merchantId } }),
    ]);

    const totalUsd = items.reduce((sum, item) => sum + item.unitPriceUsd * item.qty, 0);
    const vesRate = merchant?.vesRate ?? null;

    return {
      items: items.map((item) => ({
        nombre: item.nameSnapshot,
        cantidad: item.qty,
        precioUnitarioUsd: item.unitPriceUsd,
      })),
      totalUsd: Math.round(totalUsd * 100) / 100,
      totalVes: vesRate ? Math.round(totalUsd * vesRate * 100) / 100 : null,
    };
  }
}
