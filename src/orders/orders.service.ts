import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Merchant } from '../merchants/merchant.entity';
import { MessagingPort } from '../messaging/messaging.port';
import { CartService } from './cart.service';
import { Fulfillment, Order, OrderStatus } from './order.entity';
import { PaymentProof, ProofDecision } from './payment-proof.entity';

export type DefinirEntregaResultado =
  | { error: 'comercio_no_configurado' }
  | { definido: true; tipo: 'RETIRO' }
  | { definido: true; tipo: 'DELIVERY'; ubicacionSolicitada: true };

export type CerrarOrdenResultado =
  | { error: 'carrito_vacio' | 'falta_definir_entrega' | 'falta_ubicacion' | 'comercio_no_configurado' }
  | { cerrada: true; totalUsd: number; totalVes: number; vesRateUsed: number };

export type RegistrarComprobanteResultado = { error: 'no_hay_orden_esperando_pago' } | { registrado: true };

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
    @InjectRepository(PaymentProof) private readonly paymentProofs: Repository<PaymentProof>,
    private readonly cart: CartService,
    private readonly messaging: MessagingPort,
  ) {}

  async definirEntrega(merchantId: string, buyerPhone: string, tipo: Fulfillment): Promise<DefinirEntregaResultado> {
    const merchant = await this.merchants.findOne({ where: { id: merchantId } });
    if (!merchant) return { error: 'comercio_no_configurado' };

    const order = await this.cart.getOrCreateDraft(merchantId, buyerPhone);
    await this.orders.update({ id: order.id }, { fulfillment: tipo });

    if (tipo === Fulfillment.RETIRO) {
      return { definido: true, tipo: 'RETIRO' };
    }

    await this.messaging.sendLocationRequest(
      merchantId,
      buyerPhone,
      'Compartinos tu ubicación para coordinar el envío 📍',
    );

    return { definido: true, tipo: 'DELIVERY', ubicacionSolicitada: true };
  }

  /** Guarda la ubicación compartida en la orden BORRADOR con DELIVERY del comprador (usado por el SPEC 03). */
  async guardarUbicacion(merchantId: string, buyerPhone: string, lat: number, lng: number): Promise<void> {
    const order = await this.cart.findDraft(merchantId, buyerPhone);
    if (!order || order.fulfillment !== Fulfillment.DELIVERY) return;
    await this.orders.update({ id: order.id }, { deliveryLat: lat, deliveryLng: lng });
  }

  /**
   * Una imagen del comprador con una orden en ESPERANDO_PAGO es un
   * comprobante (SPEC 03): crea el `PaymentProof` y pasa la orden a
   * PAGO_EN_REVISION. Solo cambia estado y acusa recibo — el comercio
   * decide aceptar/rechazar desde el panel (SPEC 04).
   */
  async registrarComprobante(
    merchantId: string,
    buyerPhone: string,
    mediaId: string,
    sourceMessageId: string,
  ): Promise<RegistrarComprobanteResultado> {
    const order = await this.orders.findOne({
      where: { merchantId, buyerPhone, status: OrderStatus.ESPERANDO_PAGO },
    });

    if (!order) {
      return { error: 'no_hay_orden_esperando_pago' };
    }

    await this.paymentProofs.save(
      this.paymentProofs.create({
        orderId: order.id,
        mediaId,
        sourceMessageId,
        decision: ProofDecision.PENDIENTE,
      }),
    );
    await this.orders.update({ id: order.id }, { status: OrderStatus.PAGO_EN_REVISION });

    return { registrado: true };
  }

  async cerrar(merchantId: string, buyerPhone: string): Promise<CerrarOrdenResultado> {
    const merchant = await this.merchants.findOne({ where: { id: merchantId } });
    if (!merchant || merchant.vesRate === null || !merchant.payoutInstructions) {
      return { error: 'comercio_no_configurado' };
    }

    const order = await this.orders.findOne({
      where: { merchantId, buyerPhone, status: OrderStatus.BORRADOR },
      relations: { items: true },
    });

    if (!order || order.items.length === 0) {
      return { error: 'carrito_vacio' };
    }
    if (!order.fulfillment) {
      return { error: 'falta_definir_entrega' };
    }
    if (order.fulfillment === Fulfillment.DELIVERY && order.deliveryLat === null) {
      return { error: 'falta_ubicacion' };
    }

    const snapshot = await this.cart.snapshot(order.id, merchantId);
    const totalVes = snapshot.totalVes ?? 0;

    await this.orders.update(
      { id: order.id },
      {
        status: OrderStatus.ESPERANDO_PAGO,
        totalUsd: snapshot.totalUsd,
        totalVes,
        vesRateUsed: merchant.vesRate,
      },
    );

    await this.messaging.sendText(
      merchantId,
      buyerPhone,
      `Total: $${snapshot.totalUsd.toFixed(2)} (Bs. ${totalVes.toFixed(2)})\n\n` +
        `Para pagar:\n${merchant.payoutInstructions}\n\n` +
        `Cuando pagues, mandame la foto del comprobante acá mismo.`,
    );

    return {
      cerrada: true,
      totalUsd: snapshot.totalUsd,
      totalVes,
      vesRateUsed: merchant.vesRate,
    };
  }
}
